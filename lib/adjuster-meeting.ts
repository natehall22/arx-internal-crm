/**
 * The physical, in-person insurance adjuster meeting.
 *
 * Distinct from `insurance_call`, which is a phone call the inside-sales rep makes
 * themselves. An adjuster meeting is attended on site by a field rep while the
 * insurance adjuster inspects the roof.
 *
 * WHY IT IS ITS OWN APPOINTMENT TYPE
 * ----------------------------------
 * Not cosmetics — it exists to separate two authorities that `insurance_call`
 * conflates:
 *
 *   - The inside-sales rep BOOKS the meeting and is the one who gets paid a sit
 *     unit for it (`inside_sales_booked_by_user_id`).
 *   - The attending field rep (`closer_user_id`) CERTIFIES that it happened, by
 *     marking it completed.
 *
 * On `insurance_call` those are the same person: the inside rep books it and then
 * completes it through their own `log_call` flow, which lets them re-book to a past
 * time and self-serve the unit. `canCompleteAdjusterMeeting` closes that structurally
 * — the person who gets paid must not be the person who certifies the work happened.
 *
 * `appointment_type` and `status` are plain `text` in Postgres with no CHECK
 * constraint, so this type needs no migration of its own.
 */

import { PAYROLL_ADMIN_ROLE_SET } from '@/lib/payroll-admin-access'

export const ADJUSTER_MEETING_APPOINTMENT_TYPE = 'adjuster_meeting' as const

/**
 * A physical meeting, not a 15-minute phone call. `insurance_call` rows default to
 * 15 minutes, which is wrong for someone driving to a property and walking a roof
 * with an adjuster.
 */
export const DEFAULT_ADJUSTER_MEETING_DURATION_MINUTES = 60

export const MIN_ADJUSTER_MEETING_DURATION_MINUTES = 15
export const MAX_ADJUSTER_MEETING_DURATION_MINUTES = 8 * 60

export type AdjusterMeetingRowLike = {
  appointment_type?: string | null
  closer_user_id?: string | null
  status?: string | null
}

export function isAdjusterMeeting(row: AdjusterMeetingRowLike | null | undefined): boolean {
  if (!row) return false
  return (row.appointment_type ?? '').trim().toLowerCase() === ADJUSTER_MEETING_APPOINTMENT_TYPE
}

/** Clamp a caller-supplied duration, falling back to the physical-meeting default. */
export function normalizeAdjusterMeetingDuration(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_ADJUSTER_MEETING_DURATION_MINUTES
  const rounded = Math.round(n)
  if (rounded < MIN_ADJUSTER_MEETING_DURATION_MINUTES) return MIN_ADJUSTER_MEETING_DURATION_MINUTES
  if (rounded > MAX_ADJUSTER_MEETING_DURATION_MINUTES) return MAX_ADJUSTER_MEETING_DURATION_MINUTES
  return rounded
}

/**
 * How strictly an appointment type must be scheduled.
 *
 * THIS IS THE SINGLE DECISION POINT where adjuster meetings diverge from every
 * other appointment. It is a function of the appointment TYPE, never of a
 * caller-supplied flag — there is deliberately no `force`, `skipAvailabilityCheck`,
 * `bypassValidation` or `allowConflicts` boolean anywhere in the scheduling path,
 * because that is exactly how a relaxation leaks into inspections.
 *
 * The default branch is the STRICT one, so anything unrecognised — including
 * `'inspection'`, `'close'`, `null` and any type added in future — gets every rule
 * enforced. Relaxation is opt-in by one exact string and nothing else.
 *
 * Why adjuster meetings are relaxed: the insurance adjuster dictates the time. It
 * is routinely outside business hours (the live example is Saturday 8am), and a
 * slot they offer cannot be re-asked for. Refusing or deleting a confirmed booking
 * is worse than a missing calendar entry. None of that reasoning applies to an
 * inspection, which we schedule ourselves.
 */
export type AppointmentSchedulingPolicy = {
  /** Gate on round-robin availability / business hours / slot validation. */
  enforceAvailability: boolean
  /** Reject the booking when the assignee is already busy. */
  rejectOnConflict: boolean
  /** Delete the appointment row when the Google Calendar push fails. */
  deleteOnCalendarFailure: boolean
}

export const STRICT_SCHEDULING_POLICY: AppointmentSchedulingPolicy = {
  enforceAvailability: true,
  rejectOnConflict: true,
  deleteOnCalendarFailure: true,
}

export const ADJUSTER_MEETING_SCHEDULING_POLICY: AppointmentSchedulingPolicy = {
  enforceAvailability: false,
  rejectOnConflict: false,
  deleteOnCalendarFailure: false,
}

export function resolveSchedulingPolicy(
  appointmentType: string | null | undefined
): AppointmentSchedulingPolicy {
  if (isAdjusterMeeting({ appointment_type: appointmentType })) {
    return ADJUSTER_MEETING_SCHEDULING_POLICY
  }
  return STRICT_SCHEDULING_POLICY
}

/**
 * Title prefix for a Google Calendar event.
 *
 * The appointment PATCH route previously collapsed everything that was not a
 * `close` into "Inspection", which would silently retitle an adjuster meeting on
 * every reschedule.
 */
export function appointmentCalendarTitleLabel(
  appointmentType: string | null | undefined
): string {
  const type = (appointmentType ?? '').trim().toLowerCase()
  if (type === 'close') return 'Close'
  if (type === ADJUSTER_MEETING_APPOINTMENT_TYPE) return 'Adjuster Meeting'
  return 'Inspection'
}

export type AdjusterMeetingCompletionDecision = {
  allowed: boolean
  /** Machine-readable reason when denied, for logging and tests. */
  reason:
    | 'allowed_attendee'
    | 'allowed_admin'
    | 'not_an_adjuster_meeting'
    | 'no_attendee_assigned'
    | 'booker_cannot_self_complete'
    | 'not_attendee_or_admin'
}

/**
 * Who may mark an adjuster meeting completed.
 *
 * Allowed:
 *   1. The assigned attendee (`closer_user_id`) — they were physically there.
 *   2. A payroll/ops admin, for the real case where the rep forgets and ops closes
 *      the loop. Uses PAYROLL_ADMIN_ROLES unchanged; this never widens that set.
 *
 * Denied, specifically:
 *   - The inside-sales rep who booked it, even if they somehow hold an admin role.
 *     Paying and certifying must stay separate, and an admin-flagged inside rep
 *     would otherwise walk straight back into the self-serve hole this type exists
 *     to close. The attendee or a DIFFERENT admin has to complete it.
 *   - Any row with no attendee assigned — there is nobody who can attest to it, so
 *     it cannot be certified into a payable state.
 *
 * Pure so the precedence can be tested without a database. `completed` is the only
 * status this gates; `no_show` and `cancelled` pay nothing and stay freely settable
 * by the existing permission rules.
 */
export function canCompleteAdjusterMeeting(input: {
  appointment: AdjusterMeetingRowLike & { inside_sales_booked_by_user_id?: string | null }
  userId: string
  role?: string | null
}): AdjusterMeetingCompletionDecision {
  if (!isAdjusterMeeting(input.appointment)) {
    return { allowed: true, reason: 'not_an_adjuster_meeting' }
  }

  const attendeeId = input.appointment.closer_user_id ?? null
  if (!attendeeId) {
    return { allowed: false, reason: 'no_attendee_assigned' }
  }

  const bookerId = input.appointment.inside_sales_booked_by_user_id ?? null
  const isAttendee = attendeeId === input.userId

  // The booker can never certify their own payday. Scheduling also rejects this
  // dual assignment, but completion remains fail-closed for older/bad rows.
  if (bookerId && bookerId === input.userId) {
    return { allowed: false, reason: 'booker_cannot_self_complete' }
  }

  if (isAttendee) {
    return { allowed: true, reason: 'allowed_attendee' }
  }

  const role = (input.role ?? '').trim().toLowerCase()
  if (PAYROLL_ADMIN_ROLE_SET.has(role)) {
    return { allowed: true, reason: 'allowed_admin' }
  }

  return { allowed: false, reason: 'not_attendee_or_admin' }
}

/**
 * Appointment types the inside-sales follow-up path is allowed to mutate the status
 * of (complete / cancel / reschedule its own calls).
 *
 * `adjuster_meeting` is deliberately absent. The inside-sales queue books these but
 * must never be able to flip one to `completed` — that is the whole point of the
 * separate type. Keep this list as the single place that decision is expressed so a
 * future edit to the inside-sales route cannot quietly re-open the hole.
 */
export const INSIDE_SALES_STATUS_MUTABLE_APPOINTMENT_TYPES = ['insurance_call'] as const

export function insideSalesMayMutateAppointmentStatus(
  appointmentType: string | null | undefined
): boolean {
  const type = (appointmentType ?? '').trim().toLowerCase()
  return (INSIDE_SALES_STATUS_MUTABLE_APPOINTMENT_TYPES as readonly string[]).includes(type)
}
