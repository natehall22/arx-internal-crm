import type { SupabaseClient } from '@supabase/supabase-js'

import { canReadMessage, type Audience, type DealRef, type ThreadViewer } from '@/lib/threads/visibility'

/**
 * THE read path for deal conversations (Customer File Activity tab, API, search results).
 * Every row goes through `canReadMessage`; do not build a second timeline reader.
 */

export type ThreadMessage = {
  id: string
  user_id: string | null
  author_name: string | null
  type: string
  body: string
  created_at: string
  audience: Audience | null
  priority: 'fyi' | 'needs_reply' | 'urgent' | null
  restricted_pricing: boolean
  origin: 'human' | 'system'
  reply_to_id: string | null
  mentioned_user_ids: string[]
  pinned_at: string | null
  pin_scope: 'customer' | 'deal' | null
  pin_expires_at: string | null
  edited_at: string | null
  deleted: boolean
  /** Legacy row with no audience (team rules) — shown, never re-classified silently. */
  legacy: boolean
}

export type TimelineScope = 'deal' | 'customer'

export type TimelineFilters = {
  scope?: TimelineScope
  audiences?: Audience[]
  /** only human messages (notes/calls/texts), no system rows */
  humanOnly?: boolean
  before?: string | null
  limit?: number
}

export type Timeline = {
  messages: ThreadMessage[]
  pinned: ThreadMessage[]
  nextBefore: string | null
  /** system rows hidden by humanOnly — the UI offers "n updates". */
  hiddenSalesCount: number
}

const PAGE = 25
const MAX_PAGE = 100

/** System text written as notes by automations carries no author. */
export function effectiveOrigin(row: { origin: string | null; type: string; user_id: string | null }): 'human' | 'system' {
  if (row.origin === 'human' || row.origin === 'system') return row.origin
  if (row.type !== 'note') return row.type === 'text' || row.type === 'email' ? 'human' : 'system'
  return row.user_id ? 'human' : 'system'
}

type Row = {
  id: string
  user_id: string | null
  type: string
  body: string | null
  created_at: string
  audience: Audience | null
  origin: string | null
  priority: ThreadMessage['priority']
  restricted_pricing: boolean | null
  reply_to_id: string | null
  mentioned_user_ids: string[] | null
  pinned_at: string | null
  pin_scope: 'customer' | 'deal' | null
  pin_expires_at: string | null
  edited_at: string | null
  deleted_at: string | null
  deleted_user_name: string | null
  users?: { full_name: string | null } | { full_name: string | null }[] | null
}

const COLS =
  'id, user_id, type, body, created_at, audience, origin, priority, restricted_pricing, reply_to_id, mentioned_user_ids, pinned_at, pin_scope, pin_expires_at, edited_at, deleted_at, deleted_user_name, users(full_name)'

export function toMessage(row: Row): ThreadMessage {
  const u = Array.isArray(row.users) ? row.users[0] : row.users
  const deleted = !!row.deleted_at
  return {
    id: row.id,
    user_id: row.user_id,
    author_name: u?.full_name ?? row.deleted_user_name ?? null,
    type: row.type,
    // Tombstone: the text never leaves the server once removed (admins read it in the audit view).
    body: deleted ? '' : row.body ?? '',
    created_at: row.created_at,
    audience: row.audience,
    priority: row.priority,
    restricted_pricing: row.restricted_pricing === true,
    origin: effectiveOrigin(row),
    reply_to_id: row.reply_to_id,
    mentioned_user_ids: row.mentioned_user_ids ?? [],
    pinned_at: row.pinned_at,
    pin_scope: row.pin_scope,
    pin_expires_at: row.pin_expires_at,
    edited_at: row.edited_at,
    deleted,
    legacy: row.audience === null,
  }
}

export async function loadDeal(
  admin: SupabaseClient,
  orgId: string,
  opportunityId: string
): Promise<(NonNullable<DealRef> & { id: string; customer_id: string | null; lead_id: string | null }) | null> {
  const { data } = await admin
    .from('opportunities')
    .select('id, owner_user_id, setter_user_id, customer_id, lead_id')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .maybeSingle()
  return (data as never) ?? null
}

function stillPinned(m: ThreadMessage, now: number): boolean {
  if (!m.pinned_at) return false
  return !m.pin_expires_at || new Date(m.pin_expires_at).getTime() > now
}

export async function getTimeline(
  admin: SupabaseClient,
  viewer: ThreadViewer,
  deal: NonNullable<Awaited<ReturnType<typeof loadDeal>>>,
  filters: TimelineFilters = {},
  now = Date.now()
): Promise<Timeline> {
  const limit = Math.min(Math.max(filters.limit ?? PAGE, 1), MAX_PAGE)
  const scope: TimelineScope = filters.scope === 'customer' && deal.customer_id ? 'customer' : 'deal'

  let q = admin.from('activities').select(COLS).eq('org_id', viewer.orgId).is('referral_partner_id', null)
  q = scope === 'customer' ? q.eq('customer_id', deal.customer_id as string) : q.eq('opportunity_id', deal.id)
  if (filters.before) q = q.lt('created_at', filters.before)

  // Over-fetch: rows the viewer may not read are dropped below, and a page must still fill.
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit * 3 + 1)
  if (error) throw new Error(`timeline: ${error.message}`)

  const dealRef: DealRef = { owner_user_id: deal.owner_user_id, setter_user_id: deal.setter_user_id }
  const wanted = filters.audiences?.length ? new Set(filters.audiences) : null
  const visible: ThreadMessage[] = []
  let hiddenSalesCount = 0
  let lastSeen: string | null = null
  for (const row of (data ?? []) as unknown as Row[]) {
    lastSeen = row.created_at
    const msg = toMessage(row)
    if (!canReadMessage(viewer, dealRef, msg)) continue
    if (filters.humanOnly && msg.origin === 'system') continue
    if (wanted && msg.audience && !wanted.has(msg.audience)) continue
    // Ops sees Sales talk only behind the "Sales history" chip (the UI asks for it with audiences=sales).
    if (msg.audience === 'sales' && viewer.jobBoard && !viewer.ownerLike && !wanted?.has('sales')) {
      hiddenSalesCount++
      continue
    }
    visible.push(msg)
    if (visible.length === limit) break
  }

  const exhausted = (data ?? []).length <= limit * 3 && visible.length < limit
  const nextBefore = exhausted ? null : visible.length ? visible[visible.length - 1].created_at : lastSeen

  // Pins: customer-level alerts (max 3, every deal) + deal-level pins, audience still applies.
  const { data: pinRows } = await admin
    .from('activities')
    .select(COLS)
    .eq('org_id', viewer.orgId)
    .not('pinned_at', 'is', null)
    .is('deleted_at', null)
    .or(
      deal.customer_id
        ? `opportunity_id.eq.${deal.id},and(customer_id.eq.${deal.customer_id},pin_scope.eq.customer)`
        : `opportunity_id.eq.${deal.id}`
    )
    .order('pinned_at', { ascending: false })
    .limit(20)
  const pinned = ((pinRows ?? []) as unknown as Row[])
    .map(toMessage)
    .filter((m) => stillPinned(m, now) && canReadMessage(viewer, dealRef, m))
    .slice(0, 6)

  return { messages: visible, pinned, nextBefore, hiddenSalesCount }
}
