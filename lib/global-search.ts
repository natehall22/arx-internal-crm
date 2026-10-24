/**
 * Global search (Cmd/Ctrl-K). Which kinds of record a person may search, and whether they only find their own, mirrors
 * what their list pages already allow — search must never be a way around a page permission. The matching itself is
 * the `search_all` SQL function (pg_trgm: typos, partial phone numbers, job numbers, proposal numbers).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPhonesInText } from '@/lib/format'

export type SearchKind = 'customer' | 'job' | 'proposal' | 'opportunity'
export type SearchGroup = { kinds: SearchKind[]; owner: string | null }
export type SearchHit = { kind: SearchKind; id: string; title: string; subtitle: string; score: number }

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

export async function runSearch(admin: SupabaseClient, orgId: string, q: string, groups: SearchGroup[], limit = 20): Promise<SearchHit[]> {
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
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}

/** Where each kind opens. (Phase C moves customers to the Customer File.) */
export function hrefForHit(h: Pick<SearchHit, 'kind' | 'id'>): string {
  switch (h.kind) {
    case 'customer':
      return `/customers/${h.id}`
    case 'job':
      return `/ops/jobs/${h.id}`
    case 'proposal':
      return `/proposals/${h.id}`
    case 'opportunity':
      return `/opportunities/${h.id}`
  }
}
