/**
 * Ownership transfers reassigned at or after this instant move reporting credit to the rep who
 * re-knocked the pin. 2026-09-05T00:00 America/New_York — a clean day boundary strictly ahead of
 * every reassignment on record at the time this shipped (the latest was 2026-09-04 15:50 ET).
 *
 * The cutoff exists so this change is forward-only. Reports recompute from live data, so flipping
 * the precedence outright would have retroactively restated per-rep door counts on the 151 leads
 * already reassigned — moving credit off departed reps in periods that have already been read,
 * screenshotted and acted on. Transfers from here on are attributed to whoever actually knocked;
 * everything before keeps reporting exactly what it has always reported.
 */
export const CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM = '2026-09-05T04:00:00.000Z'

/**
 * Whether a lead's ownership transfer is recent enough to carry reporting credit with it.
 * A lead never reassigned (or a row whose `ownership_reassigned_at` was not selected) is false,
 * which is the pre-cutoff behavior — see the warning on getAttributedCanvassLeadUserId.
 */
export function canvassOwnershipTransferApplies(ownershipReassignedAt?: string | null): boolean {
  if (!ownershipReassignedAt) return false
  const reassignedAt = new Date(ownershipReassignedAt).getTime()
  if (!Number.isFinite(reassignedAt)) return false
  return reassignedAt >= Date.parse(CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM)
}

/**
 * Which rep a canvass lead's activity is credited to in reporting.
 *
 * `pin_attributed_user_id` is frozen for the life of the pin by the leads_assignee_display_names
 * trigger (it only ever fills a null), so preferring it meant a re-knocked pin kept crediting
 * whoever first dropped it — including reps who have since left. That is the read-side twin of
 * the canvass_knocks bug fixed in c94d056: on 2026-09-01 a lead Evan re-knocked still credited
 * Caleb Dearey, a deactivated canvasser, and 151 reassigned leads were in the same state.
 *
 * For transfers from CANVASS_OWNERSHIP_TRANSFER_EFFECTIVE_FROM onward, `owner_user_id` — which the
 * stale-pin rule in app/api/canvass/lead/route.ts moves to the rep who actually re-knocked — wins.
 * `pin_attributed_user_id` remains the fallback for its other genuine job: keeping a pin
 * attributed when `owner_user_id` is cleared on user delete (see app/api/canvass/data/route.ts).
 *
 * IMPORTANT: callers must select `ownership_reassigned_at`. A row missing it silently falls back
 * to the frozen pin owner rather than failing, so an omitted column looks like "nothing happened."
 */
export function getAttributedCanvassLeadUserId(lead: {
  pin_attributed_user_id?: string | null
  owner_user_id?: string | null
  ownership_reassigned_at?: string | null
}): string | null {
  if (canvassOwnershipTransferApplies(lead.ownership_reassigned_at)) {
    return lead.owner_user_id || lead.pin_attributed_user_id || null
  }
  return lead.pin_attributed_user_id || lead.owner_user_id || null
}

// Sources that count as a door unconditionally, disposition or not — matches
// migration 130_dashboard_canvass_exclude_inbound_disposition_only.sql and
// 202608250001_canvass_knocks.sql's backfill filter.
export const CANVASS_DOOR_SOURCES = new Set(['door_to_door', 'canvass', 'door_knock', 'csv_import'])

// Inbound-style sources: a disposition alone must not turn these into a canvass door
// (CRM edits or bad data could set a disposition on a web/inbound lead).
export const CANVASS_NON_DOOR_DISPOSITION_SOURCES = new Set(['web', 'inbound'])

/**
 * Whether a lead counts as a canvass "door" at all — mirrors the OR the dashboard RPCs,
 * setter ramp, and Heat door-count badges apply: an unconditional source match, or any
 * source (other than web/inbound) that carries a disposition. Used to gate writing a
 * canvass_knocks row so the write side never diverges from what the read side counts.
 */
export function isCanvassDoorEligible(lead: { source?: string | null; canvass_disposition?: string | null }): boolean {
  const source = (lead.source ?? '').trim().toLowerCase()
  if (CANVASS_DOOR_SOURCES.has(source)) return true
  return Boolean(lead.canvass_disposition) && !CANVASS_NON_DOOR_DISPOSITION_SOURCES.has(source)
}

/**
 * A row from canvass_knocks (202608250001_canvass_knocks.sql), which already resolves
 * user_id to the knock's attributed rep at write time.
 */
export type CanvassKnockRow = { user_id: string; created_at: string }

/**
 * Attribution-shaped row several door-count consumers already accept: leads.owner_user_id
 * / pin_attributed_user_id / created_at, fed through getAttributedCanvassLeadUserId.
 */
export type AttributedCanvassLeadLikeRow = {
  owner_user_id: string | null
  pin_attributed_user_id: string | null
  created_at: string
}

/**
 * Maps canvass_knocks rows onto the LeadRow shape lib/sync-setter-ramp-core.ts's pure
 * counters already expect (pin_attributed_user_id null, owner_user_id = the knock's
 * already-resolved rep), so that counting logic — and lib/__tests__/setter-ramp-utils.test.ts,
 * which exercises it directly — never needed to change shape when the door-count source
 * moved off leads.created_at.
 */
export function knocksAsAttributedLeadRows(knocks: CanvassKnockRow[]): AttributedCanvassLeadLikeRow[] {
  return knocks.map((k) => ({ owner_user_id: k.user_id, pin_attributed_user_id: null, created_at: k.created_at }))
}
