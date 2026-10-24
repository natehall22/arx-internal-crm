import { isThreadSchemaMissing, ThreadSchemaPendingError } from '@/lib/threads/schema-guard'
import type { SupabaseClient } from '@supabase/supabase-js'

import { canReadMessage, canReadRowOnDeal, type Audience, type DealRef, type ThreadViewer } from '@/lib/threads/visibility'

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
  /** Read live from another table (canvass door note); no actions. */
  synthetic?: boolean
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
  opportunity_id: string | null
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
  'id, opportunity_id, user_id, type, body, created_at, audience, origin, priority, restricted_pricing, reply_to_id, mentioned_user_ids, pinned_at, pin_scope, pin_expires_at, edited_at, deleted_at, deleted_user_name, users(full_name)'

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

type DealFull = NonNullable<DealRef> & { id: string; customer_id: string | null; lead_id: string | null; address_text: string | null; status: string | null }

/** Deal refs (owner/setter + appointment closers/canvassers) for a set of opportunities, org-scoped. */
export async function dealRefsFor(admin: SupabaseClient, orgId: string, oppIds: string[]): Promise<Map<string, NonNullable<DealRef>>> {
  const out = new Map<string, NonNullable<DealRef>>()
  const ids = Array.from(new Set(oppIds)).filter(Boolean)
  if (ids.length === 0) return out
  const [opps, appts] = await Promise.all([
    admin.from('opportunities').select('id, owner_user_id, setter_user_id').eq('org_id', orgId).in('id', ids),
    admin.from('scheduled_appointments').select('opportunity_id, closer_user_id, canvasser_user_id').eq('org_id', orgId).in('opportunity_id', ids),
  ])
  for (const o of (opps.data ?? []) as Array<{ id: string; owner_user_id: string | null; setter_user_id: string | null }>) {
    out.set(o.id, { owner_user_id: o.owner_user_id, setter_user_id: o.setter_user_id, closer_user_ids: [], extra_user_ids: [] })
  }
  for (const a of (appts.data ?? []) as Array<{ opportunity_id: string; closer_user_id: string | null; canvasser_user_id: string | null }>) {
    const d = out.get(a.opportunity_id)
    if (!d) continue
    if (a.closer_user_id) d.closer_user_ids!.push(a.closer_user_id)
    if (a.canvasser_user_id) d.extra_user_ids!.push(a.canvasser_user_id)
  }
  return out
}

export async function loadDeal(admin: SupabaseClient, orgId: string, opportunityId: string): Promise<DealFull | null> {
  const { data } = await admin
    .from('opportunities')
    .select('id, owner_user_id, setter_user_id, customer_id, lead_id, address_text, status')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data) return null
  const refs = await dealRefsFor(admin, orgId, [opportunityId])
  const ref = refs.get(opportunityId)
  return { ...(data as Omit<DealFull, 'closer_user_ids' | 'extra_user_ids'>), closer_user_ids: ref?.closer_user_ids ?? [], extra_user_ids: ref?.extra_user_ids ?? [] }
}

/** Owner/setter/appointment people of a loaded deal, as a DealRef. */
export function dealRefOf(d: { owner_user_id: string | null; setter_user_id: string | null; closer_user_ids?: string[]; extra_user_ids?: string[] }): NonNullable<DealRef> {
  return { owner_user_id: d.owner_user_id, setter_user_id: d.setter_user_id, closer_user_ids: d.closer_user_ids ?? [], extra_user_ids: d.extra_user_ids ?? [] }
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
  if (error) throw isThreadSchemaMissing(error) ? new ThreadSchemaPendingError() : new Error(`timeline: ${error.message}`)

  const dealRef: DealRef = dealRefOf(deal)
  // "All deals" mixes deals: each row is checked against ITS OWN deal, never the one that happens to be open.
  const rowDeals = scope === 'customer' ? await dealRefsFor(admin, viewer.orgId, ((data ?? []) as unknown as Row[]).map((r) => r.opportunity_id).filter((x): x is string => !!x)) : null
  const refFor = (row: Row): DealRef | 'none' => {
    if (!rowDeals) return dealRef
    if (!row.opportunity_id) return 'none'
    return rowDeals.get(row.opportunity_id) ?? 'none'
  }
  const wanted = filters.audiences?.length ? new Set(filters.audiences) : null
  const visible: ThreadMessage[] = []
  let hiddenSalesCount = 0
  let lastSeen: string | null = null
  for (const row of (data ?? []) as unknown as Row[]) {
    lastSeen = row.created_at
    const msg = toMessage(row)
    const ref = refFor(row)
    // A row with no deal of its own (customer-level note) is only for people who are not scoped to their own deals.
    if (!canReadRowOnDeal(viewer, ref, msg)) continue
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

  // The canvass door note stays on the pin (it is a pin attribute, not a conversation); show it live as the
  // oldest item once the last page is reached, so a deal's file starts with what the setter wrote at the door.
  if (scope === 'deal' && nextBefore === null && deal.lead_id && (!wanted || wanted.has('team'))) {
    const { data: lead } = await admin.from('leads').select('canvass_notes, created_at').eq('id', deal.lead_id).eq('org_id', viewer.orgId).maybeSingle()
    const note = (lead as { canvass_notes?: string | null; created_at?: string } | null)?.canvass_notes?.trim()
    if (note && !visible.some((m) => m.id === `canvass-${deal.lead_id}`)) {
      const m: ThreadMessage = {
        id: `canvass-${deal.lead_id}`, user_id: null, author_name: 'Door note (canvass)', type: 'note', body: note,
        created_at: (lead as { created_at: string }).created_at, audience: 'team', priority: null, restricted_pricing: false, origin: 'human',
        reply_to_id: null, mentioned_user_ids: [], pinned_at: null, pin_scope: null, pin_expires_at: null, edited_at: null, deleted: false, legacy: false, synthetic: true,
      }
      if (canReadMessage(viewer, dealRef, m)) visible.push(m)
    }
  }

  const pinned = await getPinned(admin, viewer, deal, now)

  return { messages: visible, pinned, nextBefore, hiddenSalesCount }
}

/** Pins for the file header: customer-level alerts (every deal) + this deal's pins. The audience still applies. */
export async function getPinned(
  admin: SupabaseClient,
  viewer: ThreadViewer,
  deal: NonNullable<Awaited<ReturnType<typeof loadDeal>>>,
  now = Date.now()
): Promise<ThreadMessage[]> {
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
  const rows = (pinRows ?? []) as unknown as Row[]
  const refs = await dealRefsFor(admin, viewer.orgId, rows.map((r) => r.opportunity_id).filter((x): x is string => !!x))
  return rows
    .filter((r) => {
      const ref = r.opportunity_id ? refs.get(r.opportunity_id) : undefined
      if (!ref) return false
      return stillPinned(toMessage(r), now) && canReadMessage(viewer, ref, toMessage(r))
    })
    .map(toMessage)
    .slice(0, 6)
}
