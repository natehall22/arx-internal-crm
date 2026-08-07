/**
 * Google Calendar handling for insurance adjuster meetings.
 *
 * The governing constraint: WE DO NOT CONTROL WHEN THE ADJUSTER SHOWS UP. They
 * dictate the time, it is frequently outside business hours (the live example is a
 * Saturday 8am), and a slot they offer cannot simply be re-asked for. That inverts
 * the rules the inspection scheduler uses, so this deliberately does NOT reuse it:
 *
 *   Inspection scheduling                  | Adjuster meeting
 *   ---------------------------------------|------------------------------------
 *   round-robin gates on availability       | no availability gating at all
 *   409s when the slot is unavailable       | always books
 *   DELETES the row if Google fails         | NEVER deletes; records for retry
 *   conflict blocks the booking             | conflict is a warning only
 *
 * None of the inspection behaviour is changed by this module — it is a separate
 * path used only by `appointment_type = 'adjuster_meeting'`.
 */

import type { CalendarEvent } from '@/lib/google-calendar'

export type AdjusterMeetingAttendeeInput = {
  /** Internal user record of the field rep who will attend. */
  attendeeEmail?: string | null
  /** Internal user record of the inside-sales rep who booked it. */
  bookerEmail?: string | null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) return null
  return trimmed
}

/**
 * Build the Google invite guest list.
 *
 * INTERNAL STAFF ONLY, and only ever these two people:
 *   1. the field rep attending, and
 *   2. the inside-sales rep who booked it, so the meeting lands on her own calendar
 *      (this is why the CRM /api/appointments query did NOT need widening).
 *
 * The homeowner and the insurance adjuster are NEVER added. This function takes no
 * parameter that could carry their address, which is the point: with `sendUpdates`
 * set to anything but 'none', Google emails every attendee, and silently emailing a
 * homeowner or a third-party adjuster is not something anyone asked for. Keeping the
 * signature closed to two named internal fields makes that mistake unrepresentable
 * rather than merely discouraged.
 *
 * A booker with no email on their user record is simply omitted — it must never
 * fail the booking.
 */
export function buildAdjusterMeetingAttendees(
  input: AdjusterMeetingAttendeeInput
): { email: string }[] {
  const attendee = normalizeEmail(input.attendeeEmail)
  const booker = normalizeEmail(input.bookerEmail)

  const emails: string[] = []
  if (attendee) emails.push(attendee)
  // Deduped: when the booker somehow is the attendee, Google must not get the same
  // address twice.
  if (booker && booker !== attendee) emails.push(booker)

  return emails.map((email) => ({ email }))
}

/**
 * `sendUpdates` for the create call.
 *
 * 'all' — so the inside-sales booker actually receives the invite on her own
 * calendar, which is the whole reason she is a guest. Because the guest list is
 * closed to the two internal staff above, "all" means exactly: the attending field
 * rep and the inside-sales booker. No homeowner, no adjuster, no external party can
 * be on the list to receive mail.
 *
 * 'none' would leave the booker with no notification and defeat the purpose;
 * 'externalOnly' would skip same-domain staff unpredictably depending on whose
 * mailbox is on which domain.
 */
export const ADJUSTER_MEETING_SEND_UPDATES = 'all' as const

/**
 * Google accepts caller-supplied event ids made from base32hex characters. A UUID's
 * lowercase hex characters are a valid subset, so the appointment id gives every
 * retry and concurrent request the same Google event identity.
 */
export function adjusterMeetingGoogleEventId(appointmentId: string): string {
  const uuidHex = appointmentId.toLowerCase().replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/.test(uuidHex)) {
    throw new Error('Adjuster meeting appointment id must be a UUID')
  }
  return `a${uuidHex}`
}

export function adjusterMeetingEventTitle(customerName: string): string {
  return `Adjuster Meeting: ${customerName || 'Customer'}`
}

export function buildAdjusterMeetingDescription(input: {
  customerName: string
  phone?: string | null
  address?: string | null
  bookedByName?: string | null
  note?: string | null
}): string {
  return [
    `Insurance adjuster meeting — ${input.customerName || 'Customer'}`,
    input.phone ? `Phone: ${input.phone}` : null,
    input.address ? `Address: ${input.address}` : null,
    input.bookedByName ? `Booked by (inside sales): ${input.bookedByName}` : null,
    '',
    'The adjuster sets this time. If it moves, update it in the CRM so the calendar follows.',
    input.note ? `Notes: ${input.note}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export function buildAdjusterMeetingEvent(input: {
  customerName: string
  startLocal: string
  endLocal: string
  timezone: string
  address?: string | null
  phone?: string | null
  bookedByName?: string | null
  note?: string | null
  attendees: { email: string }[]
}): CalendarEvent {
  return {
    summary: adjusterMeetingEventTitle(input.customerName),
    description: buildAdjusterMeetingDescription(input),
    ...(input.address ? { location: input.address } : {}),
    start: { dateTime: input.startLocal, timeZone: input.timezone },
    end: { dateTime: input.endLocal, timeZone: input.timezone },
    ...(input.attendees.length > 0 ? { attendees: input.attendees } : {}),
  }
}

export type AdjusterMeetingSyncDeps = {
  getAccessToken: (userId: string) => Promise<string | null>
  getTimezone: (userId: string) => Promise<string>
  formatLocal: (date: Date, timezone: string) => string
  createEvent: (
    token: string,
    event: CalendarEvent,
    calendarId: string,
    sendUpdates: 'all' | 'externalOnly' | 'none'
  ) => Promise<CalendarEvent>
  updateEvent: (token: string, eventId: string, event: Partial<CalendarEvent>) => Promise<unknown>
  getUserEmail: (userId: string) => Promise<string | null>
  /** Persist the successful link. */
  saveSuccess: (appointmentId: string, eventId: string) => Promise<void>
  /** Persist a failure so the UI can warn and offer a retry. */
  saveFailure: (
    appointmentId: string,
    message: string,
    knownEventId?: string | null
  ) => Promise<void>
}

export type AdjusterMeetingSyncParams = {
  appointmentId: string
  attendeeUserId: string
  bookerUserId?: string | null
  scheduledForIso: string
  durationMinutes: number
  customerName: string
  phone?: string | null
  address?: string | null
  bookedByName?: string | null
  note?: string | null
  existingEventId?: string | null
}

export type AdjusterMeetingSyncResult = {
  ok: boolean
  error: string | null
  eventId: string | null
}

export const ADJUSTER_MEETING_NO_GOOGLE_MESSAGE =
  'The attending rep has not connected Google Calendar, so this meeting is not on their calendar yet. The meeting is still booked.'

/**
 * Push an adjuster meeting to the attending rep's Google Calendar.
 *
 * NON-DESTRUCTIVE BY CONTRACT — this is the single most important property here.
 * The caller commits the `scheduled_appointments` row BEFORE calling, and nothing
 * in this function deletes, cancels or refuses it. That is the deliberate opposite
 * of the inspection scheduler, which removes the appointment and returns 409 when
 * Google fails. Losing a confirmed adjuster slot is far worse than a missing
 * calendar entry, because the adjuster cannot simply be re-asked.
 *
 * Every failure path — no Google connection, API error, missing event id — records
 * the reason via `saveFailure` so the queue can surface it and offer a retry,
 * instead of it vanishing into a response the user navigates away from.
 *
 * Updates an existing event in place when one is linked, so an adjuster moving the
 * meeting never leaves a duplicate behind.
 */
export async function syncAdjusterMeetingToGoogle(
  deps: AdjusterMeetingSyncDeps,
  params: AdjusterMeetingSyncParams
): Promise<AdjusterMeetingSyncResult> {
  let eventId: string | null = params.existingEventId || null
  const fail = async (
    message: string,
    knownEventId: string | null = eventId
  ): Promise<AdjusterMeetingSyncResult> => {
    try {
      await deps.saveFailure(params.appointmentId, message, knownEventId)
    } catch (e) {
      // Pre-migration the columns may be absent. Still never fatal.
      console.warn('syncAdjusterMeetingToGoogle: could not record sync failure', e)
    }
    return { ok: false, error: message, eventId: knownEventId }
  }

  try {
    const token = await deps.getAccessToken(params.attendeeUserId)
    if (!token) return await fail(ADJUSTER_MEETING_NO_GOOGLE_MESSAGE)

    const [attendeeEmail, bookerEmail] = await Promise.all([
      deps.getUserEmail(params.attendeeUserId),
      params.bookerUserId ? deps.getUserEmail(params.bookerUserId) : Promise.resolve(null),
    ])

    const attendees = buildAdjusterMeetingAttendees({ attendeeEmail, bookerEmail })
    const timezone = await deps.getTimezone(params.attendeeUserId)
    const start = new Date(params.scheduledForIso)
    const end = new Date(start.getTime() + params.durationMinutes * 60 * 1000)

    const event = buildAdjusterMeetingEvent({
      customerName: params.customerName,
      startLocal: deps.formatLocal(start, timezone),
      endLocal: deps.formatLocal(end, timezone),
      timezone,
      address: params.address,
      phone: params.phone,
      bookedByName: params.bookedByName,
      note: params.note,
      attendees,
    })

    if (eventId) {
      await deps.updateEvent(token, eventId, event)
    } else {
      const deterministicEventId = adjusterMeetingGoogleEventId(params.appointmentId)
      try {
        const created = await deps.createEvent(
          token,
          { ...event, id: deterministicEventId },
          'primary',
          ADJUSTER_MEETING_SEND_UPDATES
        )
        eventId = created?.id ?? null
        if (!eventId) return await fail('Google Calendar accepted the event but returned no id.')
      } catch (createError: unknown) {
        // A prior/concurrent ambiguous request may already have created this exact
        // deterministic event. A 409 is therefore success-by-reconciliation: update
        // it in place and persist the known id instead of creating another invite.
        if (!(createError instanceof Error) || !createError.message.includes('(409)')) {
          throw createError
        }
        eventId = deterministicEventId
        await deps.updateEvent(token, eventId, event)
      }
    }

    await deps.saveSuccess(params.appointmentId, eventId)
    return { ok: true, error: null, eventId }
  } catch (e: unknown) {
    console.error('syncAdjusterMeetingToGoogle failed', e)
    return await fail(
      'Google Calendar sync failed. The meeting is still booked; verify the existing calendar before retrying.'
    )
  }
}

export type AppointmentTimeSpan = {
  id: string
  scheduled_for?: string | null
  duration_minutes?: number | null
  status?: string | null
}

/**
 * Overlapping non-cancelled appointments already on the attending rep's calendar.
 *
 * Returned as a WARNING only — it must never block the booking. The adjuster chose
 * this time; the right response is to tell the inside rep so they can reassign who
 * attends, not to refuse a slot we cannot get back.
 */
export function findAttendeeConflicts(
  existing: AppointmentTimeSpan[],
  proposed: { startIso: string; durationMinutes: number; excludeAppointmentId?: string | null }
): AppointmentTimeSpan[] {
  const start = new Date(proposed.startIso).getTime()
  if (!Number.isFinite(start)) return []
  const end = start + Math.max(1, proposed.durationMinutes) * 60 * 1000

  return existing.filter((row) => {
    if (proposed.excludeAppointmentId && row.id === proposed.excludeAppointmentId) return false
    const status = (row.status ?? 'scheduled').trim().toLowerCase()
    if (status === 'cancelled') return false
    const rowStart = new Date(row.scheduled_for ?? '').getTime()
    if (!Number.isFinite(rowStart)) return false
    const rowEnd = rowStart + Math.max(1, Number(row.duration_minutes) || 60) * 60 * 1000
    return rowStart < end && rowEnd > start
  })
}

export function describeAttendeeConflict(
  conflicts: AppointmentTimeSpan[],
  attendeeName: string | null | undefined
): string | null {
  if (conflicts.length === 0) return null
  const who = attendeeName || 'The attending rep'
  return `${who} already has ${conflicts.length} other appointment${
    conflicts.length === 1 ? '' : 's'
  } at this time. The adjuster meeting was still booked — reassign who attends if needed.`
}
