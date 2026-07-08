/** Row shape needed to decide if an appointment counts as setter "inspection set". */
export type InspectionSetCountableRow = {
  appointment_type?: string | null
  status?: string | null
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

/** PostgREST `.or()` filter for inspection-type rows (matches countsAsInspectionSet type leg). */
export const INSPECTION_SET_APPOINTMENT_TYPE_OR =
  'appointment_type.is.null,appointment_type.eq.inspection' as const
