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

  if (!error && data && data.length > 0) {
    return data as AppointmentTypeTableRow[]
  }

  if (error) {
    console.error('fetchOrgAppointmentTypesFromTable:', error)
  }

  // Fallback: read from orgs.settings.appointment_types JSON for orgs that haven't
  // re-saved their admin settings since the appointment_types table was introduced.
  const { data: orgData } = await supabase
    .from('orgs')
    .select('settings')
    .eq('id', orgId)
    .single()

  const jsonTypes = orgData?.settings?.appointment_types
  if (!Array.isArray(jsonTypes) || jsonTypes.length === 0) return []

  // Admin JSON `id` is a stable key (e.g. 'inspection', 'follow_up', 'close'). Table + helpers use only
  // category 'inspection' | 'close' (see findInspectionRow / findCloseKindRow).
  return jsonTypes
    .filter((t: any) => t.active !== false)
    .map((t: any, i: number) => ({
      // Synthetic id when not from DB — not a UUID; helpers only use category/name/durations.
      id: t.id,
      org_id: orgId,
      name: t.name || t.id,
      duration_minutes: typeof t.duration_minutes === 'number' ? t.duration_minutes : 60,
      buffer_after_minutes: typeof t.buffer_after_minutes === 'number' ? t.buffer_after_minutes : 0,
      color: t.color || '#6366f1',
      description: t.description || null,
      category: t.id === 'inspection' ? 'inspection' : 'close',
      active: true,
      sort_order: i,
    })) as AppointmentTypeTableRow[]
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
