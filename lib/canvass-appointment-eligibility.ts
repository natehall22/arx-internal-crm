/**
 * Single source of truth for who can be assigned canvass / inspection appointments
 * (manual closer picker, lead POST validation, team round-robin, team availability).
 */
const APPOINTMENT_ELIGIBLE_ROLES = new Set([
  'sales_rep',
  'rep',
  'closer',
  'sales_manager',
  'regional_manager',
  'admin',
  'owner',
])

export type CanvassAppointmentUserFields = {
  active?: boolean | null
  role?: string | null
  can_receive_appointments?: boolean | null
}

/** Explicit can_receive_appointments=true wins for custom roles; otherwise legacy sales roles apply. */
export function canReceiveCanvassAppointment(user: CanvassAppointmentUserFields): boolean {
  if (user.active === false) return false
  if (user.can_receive_appointments === false) return false
  if (user.can_receive_appointments === true) return true
  return APPOINTMENT_ELIGIBLE_ROLES.has(String(user.role || ''))
}

/**
 * Members of `team_closer_queue` are explicitly chosen by admins for round-robin.
 * Do not apply org-wide role allowlists here — users may be closers with non-sales roles
 * (e.g. custom titles). Only respect active status and explicit opt-out.
 */
export function canReceiveTeamRoundRobinQueueAssignment(user: {
  active?: boolean | null
  can_receive_appointments?: boolean | null
}): boolean {
  if (user.active === false) return false
  if (user.can_receive_appointments === false) return false
  return true
}
