/**
 * Global search (Cmd/Ctrl-K). Which kinds of record a person may search, and whether they only find their own, mirrors
 * what their list pages already allow — search must never be a way around a page permission. The matching itself is
 * the `search_all` SQL function (pg_trgm: typos, partial phone numbers, job numbers, proposal numbers).
 */
import { categoryAllowed, customerCategoryMap, dealInScope, inScopeJobIds, type CategoryScope } from '@/lib/category-scope'
import { orgDb } from '@/lib/supabase/org-db'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPhonesInText } from '@/lib/format'
import { customerHref } from '@/lib/customer-file/links'

export type SearchKind = 'customer' | 'job' | 'proposal' | 'opportunity'
export type SearchGroup = { kinds: SearchKind[]; owner: string | null }
/** `matched` = why a keyword hit came up ("Line: Sprinkler repair"); absent for number / name / address hits. */
export type SearchHit = { kind: SearchKind; id: string; title: string; subtitle: string; score: number; matched?: string }

const SEES_ALL_SALES = new Set(['regional_manager', 'sales_manager'])

export function searchGroupsFor(a: {
  userId: string
  role: string | null | undefined
  isSuperuser: boolean
  canCustomers: boolean
  customersRepScoped: boolean
  canJobBoard: boolean
  canProposals: boolean
  canOpportunities: boolean
}): SearchGroup[] {
  const role = a.role ?? ''
  const seesAllSales = a.isSuperuser || SEES_ALL_SALES.has(role)
  const open: SearchKind[] = []
  const own: SearchKind[] = []
  if (a.canCustomers) (a.customersRepScoped ? own : open).push('customer')
  if (a.canJobBoard) open.push('job')
  if (a.canProposals) (seesAllSales ? open : own).push('proposal')
  if (a.canOpportunities && role !== 'setter' && role !== 'canvasser') (seesAllSales || role === 'operations' ? open : own).push('opportunity')
  return [
    ...(open.length ? [{ kinds: open, owner: null }] : []),
    ...(own.length ? [{ kinds: own, owner: a.userId }] : []),
  ]
}

export function cleanQuery(raw: unknown): string | null {
  const q = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  return q.length >= 2 && q.length <= 80 ? q : null
}

/** Most keyword ("what the work is") hits per kind: they add to the number / name / address results, never crowd them out. */
const WORK_HITS_PER_KIND = 5

export async function runSearch(admin: SupabaseClient, orgId: string, q: string, groups: SearchGroup[], limit = 20, viewerId?: string, scope?: CategoryScope): Promise<SearchHit[]> {
  // A limited person's hits are cut after the search, so ask for more to still fill the list.
  const fetchLimit = scope?.limited ? Math.min(limit * 4, 80) : limit
  const results = await Promise.all(
    groups.map((g) => admin.rpc('search_all', { p_org: orgId, p_q: q, p_kinds: g.kinds, p_owner: g.owner, p_limit: fetchLimit }))
  )
  const hits: SearchHit[] = []
  for (const r of results) {
    if (r.error) throw r.error
    for (const row of (r.data ?? []) as Array<{ kind: SearchKind; id: string; title: string; subtitle: string | null; score: number }>) {
      hits.push({ kind: row.kind, id: row.id, title: row.title, subtitle: formatPhonesInText(row.subtitle ?? ''), score: Number(row.score) })
    }
  }
  // Keyword leg (jobs by trade / line items / work orders / notes the viewer may read; customers by plan name). Best effort: until
  // migration 202611300190 is applied (or if it fails) people just get the number / name / address results.
  if (viewerId) {
    const keyword = await Promise.all(
      groups
        .map((g) => ({ ...g, kinds: g.kinds.filter((k) => k === 'job' || k === 'customer') }))
        .filter((g) => g.kinds.length > 0)
        .map((g) => admin.rpc('search_work', { p_org: orgId, p_viewer: viewerId, p_q: q, p_kinds: g.kinds, p_owner: g.owner, p_limit: WORK_HITS_PER_KIND }))
    )
    for (const r of keyword) {
      if (r.error) {
        console.error('keyword search skipped', r.error.message)
        continue
      }
      for (const row of (r.data ?? []) as Array<{ kind: SearchKind; id: string; title: string; subtitle: string | null; matched: string | null; score: number }>) {
        const same = hits.find((h) => h.kind === row.kind && h.id === row.id)
        if (same) same.matched = same.matched ?? row.matched ?? undefined
        else hits.push({ kind: row.kind, id: row.id, title: row.title, subtitle: formatPhonesInText(row.subtitle ?? ''), score: Number(row.score), matched: row.matched ?? undefined })
      }
    }
  }
  const visible = scope?.limited ? await scopeSearchHits(admin, orgId, scope, hits) : hits
  return visible.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}

/**
 * Post-filter for a person limited to some work categories (Cmd-K and the AI connector share runSearch). Customers follow their own
 * category; a job its override, else its customer; an opportunity its customer, else its lead; a proposal its opportunity's deal.
 * Anything that cannot be read is dropped (fail closed).
 */
export async function scopeSearchHits(admin: SupabaseClient, orgId: string, scope: CategoryScope, hits: SearchHit[]): Promise<SearchHit[]> {
  if (!scope.limited || hits.length === 0) return hits
  try {
    const ids = (kind: SearchKind) => hits.filter((h) => h.kind === kind).map((h) => h.id)
    const db = orgDb(admin, orgId)
    const keep = new Set<string>()
    const customers = await customerCategoryMap(admin, orgId, ids('customer'))
    for (const id of ids('customer')) if (customers.has(id) && categoryAllowed(scope, customers.get(id))) keep.add(`customer:${id}`)
    const jobIds = ids('job')
    if (jobIds.length) {
      const { data, error } = await db.from('production_jobs').select('id, customer_id').in('id', jobIds)
      if (error) throw error
      const ok = await inScopeJobIds(admin, orgId, scope, (data ?? []) as Array<{ id: string; customer_id: string | null }>)
      ok.forEach((id) => keep.add(`job:${id}`))
    }
    const proposalIds = ids('proposal')
    const propDeal = new Map<string, string>()
    if (proposalIds.length) {
      const { data, error } = await db.from('proposals').select('id, opportunity_id').in('id', proposalIds)
      if (error) throw error
      for (const p of (data ?? []) as Array<{ id: string; opportunity_id: string | null }>) if (p.opportunity_id) propDeal.set(p.id, p.opportunity_id)
    }
    const dealIds = Array.from(new Set([...ids('opportunity'), ...Array.from(propDeal.values())]))
    const dealOk = new Map<string, boolean>()
    if (dealIds.length) {
      const { data, error } = await db.from('opportunities').select('id, customer_id, lead_id').in('id', dealIds)
      if (error) throw error
      for (const d of (data ?? []) as Array<{ id: string; customer_id: string | null; lead_id: string | null }>) dealOk.set(d.id, await dealInScope(admin, orgId, scope, d))
    }
    for (const id of ids('opportunity')) if (dealOk.get(id)) keep.add(`opportunity:${id}`)
    for (const id of proposalIds) if (propDeal.has(id) && dealOk.get(propDeal.get(id) as string)) keep.add(`proposal:${id}`)
    return hits.filter((h) => keep.has(`${h.kind}:${h.id}`))
  } catch (e) {
    console.error('search scope failed', e)
    return []
  }
}

/** Where each kind opens. Customers open the Customer File where it is the company's default (lib/customer-file/links.ts). */
export function hrefForHit(h: Pick<SearchHit, 'kind' | 'id'>, customerFileDefault = false): string {
  switch (h.kind) {
    case 'customer':
      return customerHref(h.id, customerFileDefault)
    case 'job':
      return `/ops/jobs/${h.id}`
    case 'proposal':
      return `/proposals/${h.id}`
    case 'opportunity':
      return `/opportunities/${h.id}`
  }
}
