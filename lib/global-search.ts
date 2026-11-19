/**
 * Global search (Cmd/Ctrl-K). Which kinds of record a person may search, and whether they only find their own, mirrors
 * what their list pages already allow — search must never be a way around a page permission. The matching itself is
 * the `search_all` SQL function (pg_trgm: typos, partial phone numbers, job numbers, proposal numbers).
 */
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

export async function runSearch(admin: SupabaseClient, orgId: string, q: string, groups: SearchGroup[], limit = 20, viewerId?: string): Promise<SearchHit[]> {
  const results = await Promise.all(
    groups.map((g) => admin.rpc('search_all', { p_org: orgId, p_q: q, p_kinds: g.kinds, p_owner: g.owner, p_limit: limit }))
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
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
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
