/**
 * The one writer of `org_trades` (Settings → Job setup → Trades, via /api/admin/job-setup/trades).
 * Owner-only is enforced by the route; this module only enforces the list's own rules:
 *   - slugs are created from the label once and never change (rows reference them);
 *   - no deletes — deactivate instead (existing work orders and jobs keep the slug);
 *   - at least one trade stays active (a job of mixed/unknown type starts with the first active one).
 * Server only: called with the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DEFAULT_ORG_TRADES,
  ORG_TRADE_COLUMNS,
  cleanTradeLabel,
  forgetOrgTrades,
  isMissingTableError,
  orderedTrades,
  orgTradeFromRow,
  slugForNewTrade,
  type OrgTrade,
} from '@/lib/org-trades'

export type OrgTradeChange =
  | { action: 'add'; label: unknown }
  | { action: 'rename'; slug: unknown; label: unknown }
  | { action: 'setActive'; slug: unknown; active: unknown }
  | { action: 'reorder'; order: unknown }

export type OrgTradeSaveResult = { ok: true; trades: OrgTrade[] } | { ok: false; status: number; error: string }

const NOT_READY = 'Trades can be edited once the database update for this page is applied. Until then every company uses the standard list.'

async function readRows(client: SupabaseClient, orgId: string): Promise<{ trades: OrgTrade[] } | { error: OrgTradeSaveResult }> {
  const { data, error } = await client.from('org_trades').select(ORG_TRADE_COLUMNS).eq('org_id', orgId)
  if (error) {
    if (isMissingTableError(error)) return { error: { ok: false, status: 503, error: NOT_READY } }
    console.error('[org-trades-admin] read failed', error)
    return { error: { ok: false, status: 500, error: 'Could not load trades' } }
  }
  return { trades: orderedTrades(((data ?? []) as Parameters<typeof orgTradeFromRow>[0][]).map(orgTradeFromRow)) }
}

function fail(status: number, error: string): OrgTradeSaveResult {
  return { ok: false, status, error }
}

export async function saveOrgTradeChange(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  change: OrgTradeChange
): Promise<OrgTradeSaveResult> {
  let loaded = await readRows(client, orgId)
  if ('error' in loaded) return loaded.error

  // A company with no rows yet (created before the seed trigger) starts from the standard list.
  if (loaded.trades.length === 0) {
    const { error } = await client.from('org_trades').upsert(
      DEFAULT_ORG_TRADES.map((t) => ({ org_id: orgId, slug: t.slug, label: t.label, sort: t.sort, active: t.active, match_keywords: t.matchKeywords })),
      { onConflict: 'org_id,slug', ignoreDuplicates: true }
    )
    if (error) return fail(500, 'Could not set up the trades list')
    loaded = await readRows(client, orgId)
    if ('error' in loaded) return loaded.error
  }
  const trades = loaded.trades
  const bySlug = new Map(trades.map((t) => [t.slug, t]))
  const findTrade = (slug: unknown) => (typeof slug === 'string' ? bySlug.get(slug) ?? null : null)

  let error: { message?: string } | null = null
  switch (change.action) {
    case 'add': {
      const label = cleanTradeLabel(change.label)
      if (!label) return fail(400, 'Enter a name up to 40 characters')
      if (trades.some((t) => t.label.toLowerCase() === label.toLowerCase())) return fail(409, `${label} is already on the list`)
      const slug = slugForNewTrade(label, trades.map((t) => t.slug))
      if (!slug) return fail(400, 'Use letters or numbers in the name')
      const sort = Math.max(0, ...trades.map((t) => t.sort)) + 10
      ;({ error } = await client.from('org_trades').insert({ org_id: orgId, slug, label, sort, active: true, match_keywords: null, updated_by: userId }))
      break
    }
    case 'rename': {
      const trade = findTrade(change.slug)
      if (!trade) return fail(404, 'Trade not found')
      const label = cleanTradeLabel(change.label)
      if (!label) return fail(400, 'Enter a name up to 40 characters')
      if (trades.some((t) => t.slug !== trade.slug && t.label.toLowerCase() === label.toLowerCase())) return fail(409, `${label} is already on the list`)
      ;({ error } = await client.from('org_trades').update({ label, updated_by: userId }).eq('org_id', orgId).eq('slug', trade.slug))
      break
    }
    case 'setActive': {
      const trade = findTrade(change.slug)
      if (!trade) return fail(404, 'Trade not found')
      if (typeof change.active !== 'boolean') return fail(400, 'active must be true or false')
      if (!change.active && trades.filter((t) => t.active && t.slug !== trade.slug).length === 0) {
        return fail(400, 'Keep at least one trade turned on')
      }
      ;({ error } = await client.from('org_trades').update({ active: change.active, updated_by: userId }).eq('org_id', orgId).eq('slug', trade.slug))
      break
    }
    case 'reorder': {
      const order = Array.isArray(change.order) ? change.order : null
      const same =
        order !== null &&
        order.length === trades.length &&
        new Set(order).size === order.length &&
        order.every((slug) => bySlug.has(slug as string))
      if (!same) return fail(400, 'The list changed — reload and try again')
      // One statement, so a reorder is all or nothing.
      ;({ error } = await client.from('org_trades').upsert(
        (order as string[]).map((slug, i) => {
          const t = bySlug.get(slug)!
          return { org_id: orgId, slug, label: t.label, active: t.active, match_keywords: t.matchKeywords, sort: (i + 1) * 10, updated_by: userId }
        }),
        { onConflict: 'org_id,slug' }
      ))
      break
    }
    default:
      return fail(400, 'Unknown change')
  }
  if (error) {
    console.error('[org-trades-admin] write failed', error)
    return fail(500, 'Could not save')
  }

  forgetOrgTrades(client, orgId)
  const after = await readRows(client, orgId)
  if ('error' in after) return after.error
  return { ok: true, trades: after.trades }
}
