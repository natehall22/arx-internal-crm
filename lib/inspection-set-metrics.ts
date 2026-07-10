import type { SupabaseClient } from '@supabase/supabase-js'

/** Row shape needed to decide if an appointment counts as setter "inspection set". */
export type InspectionSetCountableRow = {
  appointment_type?: string | null
  status?: string | null
}

export type OrgInspectionSetRow = InspectionSetCountableRow & {
  id: string
  canvasser_user_id?: string | null
  closer_user_id?: string | null
}

/**
 * True when a scheduled_appointments row is an initial canvass inspection set.
 * Excludes close / follow-up / insurance follow-up rows and cancelled reschedules.
 */
export function countsAsInspectionSet(row: InspectionSetCountableRow): boolean {
  const type = row.appointment_type
  // Match SQL: appointment_type IS NULL OR appointment_type = 'inspection'
  if (type != null && type !== 'inspection') return false
  const status = (row.status ?? 'scheduled').trim().toLowerCase()
  if (status === 'cancelled') return false
  return true
}

/**
 * Org-wide "inspections scheduled" for owner rollups: any initial inspection set
 * credited to a canvasser (setter, manager, admin, etc.) OR to a closer when
 * canvasser_user_id is unset (common when management schedules directly).
 */
export function countsAsOrgInspectionSet(row: OrgInspectionSetRow): boolean {
  if (!countsAsInspectionSet(row)) return false
  return Boolean(row.canvasser_user_id || row.closer_user_id)
}

/** PostgREST `.or()` filter for inspection-type rows (matches countsAsInspectionSet type leg). */
export const INSPECTION_SET_APPOINTMENT_TYPE_OR =
  'appointment_type.is.null,appointment_type.eq.inspection' as const

const DEFAULT_PAGE_SIZE = 1000

/**
 * Count distinct initial inspection appointments created in [startIso, endIso).
 * Uses created_at (same as dashboard_inspections_set_by_canvasser / team-stats).
 * Includes manager/admin/closer-scheduled rows, not only setter canvasser credit.
 */
export async function countOrgInspectionSetsInPeriod(
  supabase: SupabaseClient,
  params: {
    orgId: string
    startIso: string
    endIso: string
    pageSize?: number
  }
): Promise<number> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
  const seen = new Set<string>()
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('scheduled_appointments')
      .select('id, canvasser_user_id, closer_user_id, appointment_type, status')
      .eq('org_id', params.orgId)
      .gte('created_at', params.startIso)
      .lt('created_at', params.endIso)
      .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error

    const page = (data || []) as OrgInspectionSetRow[]
    for (const row of page) {
      if (!countsAsOrgInspectionSet(row)) continue
      seen.add(row.id)
    }

    if (page.length < pageSize) break
    offset += pageSize
  }

  return seen.size
}
