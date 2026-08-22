/**
 * Shared mapping for Postgres / trigger errors raised by writes to
 * `scheduled_appointments` (migration 077, widened by 202608170001 to enforce the
 * per-appointment "buffer after slot" gap from Admin → Scheduling).
 *
 * These are user-correctable scheduling problems, not server faults — every route
 * that books or reschedules should return a 409 with actionable copy rather than a
 * generic 500.
 */

export type ScheduledAppointmentWriteError = {
  message?: string
  code?: string
  details?: string
}

export type MappedAppointmentError = { message: string; status: number }


export function mapScheduledAppointmentWriteError(
  err: ScheduledAppointmentWriteError,
  fallbackMessage = 'Failed to save appointment'
): MappedAppointmentError {
  const raw = [err.message, err.details].filter(Boolean).join(' ')

  if (
    err.code === '23P01' ||
    raw.includes('Scheduling conflict') ||
    raw.includes('overlapping appointment')
  ) {
    return {
      message:
        'This rep already has another appointment that overlaps this time, or sits inside the gap required between appointments (Admin → Scheduling). Reschedule one of the appointments, change duration if appropriate, or pick a different rep.',
      status: 409,
    }
  }

  // Checked before the generic 23505 branch — the lead-slot unique index and the
  // rapid-duplicate guard share that code, and the specific copy is more useful.
  if (err.code === '23505' && raw.toLowerCase().includes('lead_id')) {
    return {
      message: 'Another active appointment already exists for this lead at this time.',
      status: 409,
    }
  }

  if (err.code === '23505' || raw.includes('Rapid duplicate')) {
    return {
      message: 'A matching appointment was just created. Refresh the page and try again.',
      status: 409,
    }
  }

  return { message: fallbackMessage, status: 500 }
}
