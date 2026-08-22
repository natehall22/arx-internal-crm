/**
 * Maps the `slot_kind` query param used by the availability APIs onto the
 * matching `appointment_types` row so slot generation applies the same
 * per-type buffer that booking stamps onto `scheduled_appointments`.
 *
 * The availability routes serve both the canvass inspection picker and the
 * close/follow-up pickers, so the kind has to travel with the request —
 * inferring it from `duration` is not reliable (types can share a duration).
 */

import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionBufferAfterFromTable,
  getCloseSlotBufferAfterFromTable,
  type CloseSlotKind,
} from '@/lib/org-appointment-types'

export type SlotKind = 'inspection' | CloseSlotKind

const SLOT_KINDS: SlotKind[] = ['inspection', 'close', 'follow_up', 'insurance_follow_up']

/** Unknown/missing values fall back to `inspection` — the canvass picker's default. */
export function parseSlotKindParam(raw: string | null | undefined): SlotKind {
  const v = (raw ?? '').trim().toLowerCase()
  return (SLOT_KINDS as string[]).includes(v) ? (v as SlotKind) : 'inspection'
}

/**
 * Trailing gap configured for this appointment type in Admin → Scheduling.
 * Falls back to the org default gap when the type row has no explicit value.
 */
export async function resolveSlotKindBufferAfter(
  supabase: { from: (table: string) => any },
  orgId: string,
  kind: SlotKind,
  orgDefaultGapMinutes: number
): Promise<number> {
  const rows = await fetchOrgAppointmentTypesFromTable(supabase, orgId)
  if (kind === 'inspection') {
    return getInspectionBufferAfterFromTable(rows, orgDefaultGapMinutes)
  }
  return getCloseSlotBufferAfterFromTable(rows, kind, orgDefaultGapMinutes)
}
