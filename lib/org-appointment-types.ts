/**
 * Durations and per-type "after slot" buffers for inspection / close flows come from the
 * `appointment_types` table (Admin → Scheduling), not from orgs.settings JSON.
 *
 * Close-category rows are matched by `category === 'close'` and `name` (case-insensitive):
 * - kind "close" → name "Close" or contains "close"/"contract" but not "follow"
 * - kind "follow_up" → name contains "follow"
 * - kind "insurance_follow_up" → name contains "insurance", else same as follow_up
 */

export type AppointmentTypeTableRow = {
  id: string
  org_id: string
  name: string
  duration_minutes: number
  /** Present after migration 083; absent/null treated as fallback (org default gap). */
  buffer_after_minutes?: number | null
  color: string
  description: string | null
  category: string
  active: boolean
  sort_order: number
}

export type CloseSlotKind = 'close' | 'follow_up' | 'insurance_follow_up'

export async function fetchOrgAppointmentTypesFromTable(
  supabase: { from: (table: string) => any },
  orgId: string
): Promise<AppointmentTypeTableRow[]> {
  const { data, error } = await supabase
    .from('appointment_types')
    .select(
      'id, org_id, name, duration_minutes, buffer_after_minutes, color, description, category, active, sort_order'
    )
    .eq('org_id', orgId)
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('fetchOrgAppointmentTypesFromTable:', error)
    return []
  }
  return (data || []) as AppointmentTypeTableRow[]
}

function findCloseKindRow(
  rows: AppointmentTypeTableRow[],
  kind: CloseSlotKind
): AppointmentTypeTableRow | null {
  const closeRows = rows.filter((r) => r.category === 'close')
  if (closeRows.length === 0) return null

  const norm = (s: string) => s.trim().toLowerCase()

  if (kind === 'close') {
    const exact = closeRows.find((t) => norm(t.name) === 'close')
    if (exact) return exact
    const contract = closeRows.find(
      (t) =>
        (norm(t.name).includes('close') || norm(t.name).includes('contract')) &&
        !norm(t.name).includes('follow')
    )
    if (contract) return contract
    return closeRows[0]
  }

  if (kind === 'follow_up') {
    const fu = closeRows.find((t) => norm(t.name).includes('follow'))
    if (fu) return fu
    return closeRows[0]
  }

  const ins = closeRows.find((t) => norm(t.name).includes('insurance'))
  if (ins) return ins
  const fu = closeRows.find((t) => norm(t.name).includes('follow'))
  if (fu) return fu
  return closeRows[0]
}

function findInspectionRow(rows: AppointmentTypeTableRow[]): AppointmentTypeTableRow | null {
  const inspection = rows.filter((r) => r.category === 'inspection')
  return inspection[0] ?? null
}

/** First active inspection type by sort_order (matches canvass / setter scheduling). */
export function getInspectionDurationFromTable(
  rows: AppointmentTypeTableRow[],
  fallback: number
): number {
  const first = findInspectionRow(rows)
  return typeof first?.duration_minutes === 'number' ? first.duration_minutes : fallback
}

export function getInspectionBufferAfterFromTable(
  rows: AppointmentTypeTableRow[],
  fallback: number
): number {
  const row = findInspectionRow(rows)
  if (row && typeof row.buffer_after_minutes === 'number') return row.buffer_after_minutes
  return fallback
}

/**
 * Close-category durations from Admin → Scheduling (Close Types section).
 */
export function getCloseSlotDurationFromTable(
  rows: AppointmentTypeTableRow[],
  kind: CloseSlotKind,
  fallback: number
): number {
  const row = findCloseKindRow(rows, kind)
  return row && typeof row.duration_minutes === 'number' ? row.duration_minutes : fallback
}

/** Per-type buffer after slot end (close flows), fallback to org default scheduling gap. */
export function getCloseSlotBufferAfterFromTable(
  rows: AppointmentTypeTableRow[],
  kind: CloseSlotKind,
  fallback: number
): number {
  const row = findCloseKindRow(rows, kind)
  if (row && typeof row.buffer_after_minutes === 'number') return row.buffer_after_minutes
  return fallback
}
