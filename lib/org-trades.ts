/**
 * Each company's own trades list — the crews a job can need (roofing, gutters, siding, …).
 *
 * ONE source: the `org_trades` table (migration 202611060020), read through {@link loadOrgTrades}.
 * {@link DEFAULT_ORG_TRADES} is what every company is seeded with and what the app falls back to
 * while the table is missing or empty for an org — it is not a second list to edit.
 *
 * Slugs are stored on `work_orders.trade` (composite FK to org_trades) and allowed on
 * `production_jobs.job_type`, so they never change once created. A trade is never deleted: it is
 * deactivated, which hides it from "+ Add trade" and auto-detection but keeps every existing row valid.
 *
 * The pure helpers here are client-safe; `loadOrgTrades` only uses the client it is handed. Client
 * components never query the table: they get the list from the server (page props or API response).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** A trade slug (`work_orders.trade`). Any company's slug, so a plain string. */
export type Trade = string

export type OrgTrade = {
  slug: string
  label: string
  sort: number
  active: boolean
  /**
   * Line-item auto-detection: case-insensitive regular-expression alternatives matched against a sold
   * line item's `name category`. null/empty = never auto-added (added by hand from the job page).
   */
  matchKeywords: string[] | null
}

/** What a client needs to show and pick trades. */
export type OrgTradeOption = Pick<OrgTrade, 'slug' | 'label' | 'active'>

/**
 * Seed for every company (migration 202611060020 inserts exactly these — a test keeps them equal).
 * Detection is deliberately conservative: a missed trade is one "+ Add trade" click; a wrong one books a
 * crew nobody needs. Fascia/soffit are NOT matched — the roofer, the gutter crew or the siding crew does
 * them depending on the job, so ops decides.
 */
export const DEFAULT_ORG_TRADES: readonly OrgTrade[] = Object.freeze([
  { slug: 'roofing', label: 'Roofing', sort: 10, active: true, matchKeywords: null },
  { slug: 'gutters', label: 'Gutters', sort: 20, active: true, matchKeywords: ['gutter', 'downspout'] },
  { slug: 'siding', label: 'Siding', sort: 30, active: true, matchKeywords: ['siding'] },
  { slug: 'windows', label: 'Windows', sort: 40, active: true, matchKeywords: ['\\bwindows?\\b'] },
  { slug: 'other', label: 'Other', sort: 50, active: true, matchKeywords: null },
])

/** `production_jobs.job_type` for a job with more than one trade — allowed beside every slug. */
export const MIXED_JOB_TYPE = 'mixed'

export const TRADE_LABEL_MAX = 40
const SLUG_RE = /^[a-z][a-z0-9_]{0,39}$/

/* ------------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------------ */

/** The list in display order (sort, then label). */
export function orderedTrades<T extends Pick<OrgTrade, 'sort' | 'label'>>(trades: readonly T[]): T[] {
  return [...trades].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
}

export function activeTrades<T extends Pick<OrgTrade, 'sort' | 'label' | 'active'>>(trades: readonly T[]): T[] {
  return orderedTrades(trades).filter((t) => t.active)
}

export function tradeOptions(trades: readonly OrgTrade[]): OrgTradeOption[] {
  return orderedTrades(trades).map((t) => ({ slug: t.slug, label: t.label, active: t.active }))
}

/** Display name for any trade slug: the company's label, else the slug title-cased ("electrical" → "Electrical"). */
export function tradeLabel(slug: string | null | undefined, trades: readonly Pick<OrgTrade, 'slug' | 'label'>[] = DEFAULT_ORG_TRADES): string {
  const s = String(slug ?? '')
  const known = trades.find((t) => t.slug === s)?.label
  if (known) return known
  const t = s.replace(/[_-]+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Other'
}

/** Can a crew of this trade be ADDED now (active trades only — inactive ones stay valid on existing rows). */
export function isAddableTrade(value: unknown, trades: readonly Pick<OrgTrade, 'slug' | 'active'>[]): value is Trade {
  return typeof value === 'string' && trades.some((t) => t.slug === value && t.active)
}

function keywordPattern(keywords: string[] | null): RegExp | null {
  const parts = (keywords ?? []).map((k) => k.trim()).filter(Boolean)
  if (parts.length === 0) return null
  try {
    return new RegExp(parts.join('|'), 'i')
  } catch {
    return null
  }
}

/** Active trades whose keywords match any sold line item, in list order. */
export function detectTradesFromLineItems(
  items: { name?: string | null; category?: string | null }[],
  trades: readonly OrgTrade[] = DEFAULT_ORG_TRADES
): Trade[] {
  const patterns = activeTrades(trades)
    .map((t) => [t.slug, keywordPattern(t.matchKeywords)] as const)
    .filter((p): p is readonly [string, RegExp] => p[1] !== null)
  const found = new Set<Trade>()
  for (const item of items) {
    const text = `${item.name ?? ''} ${item.category ?? ''}`
    for (const [slug, pattern] of patterns) {
      if (pattern.test(text)) found.add(slug)
    }
  }
  return activeTrades(trades).map((t) => t.slug).filter((s) => found.has(s))
}

/** The crew a job of mixed or unknown type starts with: the first active trade in the company's list. */
export function defaultPrimaryTrade(trades: readonly OrgTrade[] = DEFAULT_ORG_TRADES): Trade {
  return activeTrades(trades)[0]?.slug ?? orderedTrades(trades)[0]?.slug ?? DEFAULT_ORG_TRADES[0].slug
}

const JOB_TYPE_SYNONYMS: Record<string, string> = { gutter: 'gutters', window: 'windows' }

/** The trade a job always has, from its `job_type`: that trade when the company has it, else the default primary. */
export function primaryTradeForJobType(jobType: string | null | undefined, trades: readonly OrgTrade[] = DEFAULT_ORG_TRADES): Trade {
  const t = String(jobType ?? '').toLowerCase().trim()
  const slug = JOB_TYPE_SYNONYMS[t] ?? t
  if (slug && slug !== MIXED_JOB_TYPE && trades.some((x) => x.slug === slug)) return slug
  return defaultPrimaryTrade(trades)
}

/** Trade rows in the company's order, then creation time. Unknown slugs go last. */
export function sortTrades<T extends { trade: Trade; created_at: string }>(rows: T[], trades: readonly OrgTrade[] = DEFAULT_ORG_TRADES): T[] {
  const order = new Map(orderedTrades(trades).map((t, i) => [t.slug, i]))
  const rank = (slug: string) => order.get(slug) ?? Number.MAX_SAFE_INTEGER
  return [...rows].sort((a, b) => rank(a.trade) - rank(b.trade) || a.created_at.localeCompare(b.created_at))
}

/** A new trade's slug from its label ("Solar panels" → "solar_panels"); `taken` slugs get a numeric suffix. */
export function slugForNewTrade(label: string, taken: readonly string[]): string | null {
  let base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  if (!base) return null
  if (!/^[a-z]/.test(base)) base = `t_${base}`
  const reserved = new Set([...taken, MIXED_JOB_TYPE])
  let slug = base
  for (let n = 2; reserved.has(slug); n++) slug = `${base}_${n}`
  return SLUG_RE.test(slug) ? slug : null
}

export function cleanTradeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.replace(/\s+/g, ' ').trim()
  if (!label || label.length > TRADE_LABEL_MAX) return null
  return label
}

/* ------------------------------------------------------------------------ *
 * Loading (server)
 * ------------------------------------------------------------------------ */

type OrgTradeDbRow = { slug: string; label: string; sort: number | null; active: boolean | null; match_keywords: string[] | null }

export const ORG_TRADE_COLUMNS = 'slug, label, sort, active, match_keywords'

export function orgTradeFromRow(row: OrgTradeDbRow): OrgTrade {
  return {
    slug: row.slug,
    label: row.label,
    sort: Number(row.sort ?? 0),
    active: row.active !== false,
    matchKeywords: Array.isArray(row.match_keywords) ? row.match_keywords : null,
  }
}

/** PostgREST / Postgres "relation does not exist" — the migration is not applied yet. */
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = String(error.message ?? '')
  return error.code === '42P01' || error.code === 'PGRST205' || (/org_trades/.test(msg) && /does not exist|could not find/i.test(msg))
}

export type OrgTradesLoad = { trades: OrgTrade[]; source: 'table' | 'default' }

/** Per client instance (one service client per request), per org. */
const cache = new WeakMap<object, Map<string, Promise<OrgTradesLoad>>>()

async function fetchOrgTrades(client: SupabaseClient, orgId: string): Promise<OrgTradesLoad> {
  const fallback: OrgTradesLoad = { trades: DEFAULT_ORG_TRADES.map((t) => ({ ...t })), source: 'default' }
  try {
    const { data, error } = await client.from('org_trades').select(ORG_TRADE_COLUMNS).eq('org_id', orgId)
    if (error) {
      if (!isMissingTableError(error)) console.error('[org-trades] load failed — using the default list', error)
      return fallback
    }
    const rows = ((data ?? []) as OrgTradeDbRow[]).map(orgTradeFromRow)
    return rows.length > 0 ? { trades: orderedTrades(rows), source: 'table' } : fallback
  } catch (e) {
    console.error('[org-trades] load threw — using the default list', e)
    return fallback
  }
}

/** The company's trades (active and inactive), in order. Cached for the life of `client`. */
export async function loadOrgTradesWithSource(client: SupabaseClient, orgId: string): Promise<OrgTradesLoad> {
  let byOrg = cache.get(client as object)
  if (!byOrg) {
    byOrg = new Map()
    cache.set(client as object, byOrg)
  }
  let pending = byOrg.get(orgId)
  if (!pending) {
    pending = fetchOrgTrades(client, orgId)
    byOrg.set(orgId, pending)
  }
  return pending
}

export async function loadOrgTrades(client: SupabaseClient, orgId: string): Promise<OrgTrade[]> {
  return (await loadOrgTradesWithSource(client, orgId)).trades
}

/** Drop the cached list after a write, so the same client reads the new one. */
export function forgetOrgTrades(client: SupabaseClient, orgId: string): void {
  cache.get(client as object)?.delete(orgId)
}
