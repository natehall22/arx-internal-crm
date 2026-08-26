export function getAttributedCanvassLeadUserId(lead: {
  pin_attributed_user_id?: string | null
  owner_user_id?: string | null
}): string | null {
  // Reporting should stick with the frozen canvass attribution when present.
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
