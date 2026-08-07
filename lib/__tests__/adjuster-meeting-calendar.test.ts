import {
  ADJUSTER_MEETING_SEND_UPDATES,
  adjusterMeetingGoogleEventId,
  buildAdjusterMeetingAttendees,
  buildAdjusterMeetingEvent,
  describeAttendeeConflict,
  findAttendeeConflicts,
  syncAdjusterMeetingToGoogle,
} from '@/lib/adjuster-meeting-calendar'
import { appointmentCalendarTitleLabel } from '@/lib/adjuster-meeting'

const REP = 'nathan@arxroofing.com'
const BOOKER = 'rovin1006@gmail.com'
const HOMEOWNER = 'author.jones@example.com'
const ADJUSTER = 'adjuster@allstate.example.com'
const APPOINTMENT_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('Google invite guest list — internal staff only', () => {
  it('invites the attending rep and the inside-sales booker', () => {
    expect(buildAdjusterMeetingAttendees({ attendeeEmail: REP, bookerEmail: BOOKER })).toEqual([
      { email: REP },
      { email: BOOKER },
    ])
  })

  it('never emails the homeowner or the adjuster', () => {
    // The builder takes no parameter that could carry an external address, so the
    // only way they could appear is if one were passed as staff. Assert the shape
    // holds and that no external address survives anywhere in the event.
    const attendees = buildAdjusterMeetingAttendees({ attendeeEmail: REP, bookerEmail: BOOKER })
    const emails = attendees.map((a) => a.email)
    expect(emails).not.toContain(HOMEOWNER)
    expect(emails).not.toContain(ADJUSTER)
    expect(emails).toHaveLength(2)

    const event = buildAdjusterMeetingEvent({
      customerName: 'Author Jones',
      startLocal: '2026-08-08T08:00:00',
      endLocal: '2026-08-08T09:00:00',
      timezone: 'America/New_York',
      address: '540 Acorn Oaks Dr',
      phone: '555-0100',
      bookedByName: 'Roda Temanil',
      attendees,
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain(HOMEOWNER)
    expect(serialized).not.toContain(ADJUSTER)
    expect(event.attendees).toEqual([{ email: REP }, { email: BOOKER }])
  })

  it('does not fail when the booker has no email on their user record', () => {
    expect(buildAdjusterMeetingAttendees({ attendeeEmail: REP, bookerEmail: null })).toEqual([
      { email: REP },
    ])
    expect(buildAdjusterMeetingAttendees({ attendeeEmail: REP, bookerEmail: '   ' })).toEqual([
      { email: REP },
    ])
    expect(buildAdjusterMeetingAttendees({ attendeeEmail: REP, bookerEmail: 'not-an-email' })).toEqual([
      { email: REP },
    ])
  })

  it('deduplicates when the booker is also the attendee', () => {
    expect(buildAdjusterMeetingAttendees({ attendeeEmail: REP, bookerEmail: REP.toUpperCase() })).toEqual([
      { email: REP },
    ])
  })

  it('omits attendees entirely when nobody has an email', () => {
    const event = buildAdjusterMeetingEvent({
      customerName: 'Author Jones',
      startLocal: '2026-08-08T08:00:00',
      endLocal: '2026-08-08T09:00:00',
      timezone: 'America/New_York',
      attendees: buildAdjusterMeetingAttendees({ attendeeEmail: null, bookerEmail: null }),
    })
    expect(event.attendees).toBeUndefined()
  })

  it("sends invites so the booker's own calendar actually gets it", () => {
    // 'all' is safe precisely because the guest list is closed to two internal staff.
    expect(ADJUSTER_MEETING_SEND_UPDATES).toBe('all')
  })
})

describe('event shape', () => {
  it('derives one Google-safe id from the appointment UUID for every retry', () => {
    expect(adjusterMeetingGoogleEventId(APPOINTMENT_ID)).toBe(
      'a123e4567e89b12d3a456426614174000'
    )
  })

  it('titles the event as an adjuster meeting, not an inspection', () => {
    const event = buildAdjusterMeetingEvent({
      customerName: 'Author Jones',
      startLocal: '2026-08-08T08:00:00',
      endLocal: '2026-08-08T09:00:00',
      timezone: 'America/New_York',
      attendees: [],
    })
    expect(event.summary).toBe('Adjuster Meeting: Author Jones')
    expect(event.start).toEqual({
      dateTime: '2026-08-08T08:00:00',
      timeZone: 'America/New_York',
    })
  })

  it('keeps the calendar title correct on reschedule for every type', () => {
    expect(appointmentCalendarTitleLabel('adjuster_meeting')).toBe('Adjuster Meeting')
    expect(appointmentCalendarTitleLabel('close')).toBe('Close')
    // Unchanged for inspections and untyped legacy rows.
    expect(appointmentCalendarTitleLabel('inspection')).toBe('Inspection')
    expect(appointmentCalendarTitleLabel(null)).toBe('Inspection')
  })
})

describe('calendar persistence failures', () => {
  it('reports failure when Google succeeds but the event link cannot be saved', async () => {
    const saveFailure = jest.fn().mockResolvedValue(undefined)
    const result = await syncAdjusterMeetingToGoogle(
      {
        getAccessToken: jest.fn().mockResolvedValue('token'),
        getTimezone: jest.fn().mockResolvedValue('America/New_York'),
        formatLocal: (date) => date.toISOString().slice(0, 19),
        createEvent: jest.fn().mockResolvedValue({ id: 'google-event-1' }),
        updateEvent: jest.fn(),
        getUserEmail: jest.fn().mockResolvedValue(null),
        saveSuccess: jest.fn().mockRejectedValue(new Error('database link failed')),
        saveFailure,
      },
      {
        appointmentId: APPOINTMENT_ID,
        attendeeUserId: 'rep-1',
        scheduledForIso: '2026-08-08T12:00:00.000Z',
        durationMinutes: 60,
        customerName: 'Customer',
      }
    )

    expect(result.ok).toBe(false)
    expect(result.eventId).toBe('google-event-1')
    expect(saveFailure).toHaveBeenCalledWith(
      APPOINTMENT_ID,
      expect.any(String),
      'google-event-1'
    )
  })

  it('reconciles a concurrent deterministic create instead of sending a second invite', async () => {
    const deterministicId = adjusterMeetingGoogleEventId(APPOINTMENT_ID)
    const updateEvent = jest.fn().mockResolvedValue({ id: deterministicId })
    const saveSuccess = jest.fn().mockResolvedValue(undefined)
    const result = await syncAdjusterMeetingToGoogle(
      {
        getAccessToken: jest.fn().mockResolvedValue('token'),
        getTimezone: jest.fn().mockResolvedValue('America/New_York'),
        formatLocal: (date) => date.toISOString().slice(0, 19),
        createEvent: jest.fn().mockRejectedValue(new Error('Google Calendar create failed (409)')),
        updateEvent,
        getUserEmail: jest.fn().mockResolvedValue(null),
        saveSuccess,
        saveFailure: jest.fn(),
      },
      {
        appointmentId: APPOINTMENT_ID,
        attendeeUserId: 'rep-1',
        scheduledForIso: '2026-08-08T12:00:00.000Z',
        durationMinutes: 60,
        customerName: 'Customer',
      }
    )

    expect(result).toEqual({ ok: true, error: null, eventId: deterministicId })
    expect(updateEvent).toHaveBeenCalledWith('token', deterministicId, expect.any(Object))
    expect(saveSuccess).toHaveBeenCalledWith(APPOINTMENT_ID, deterministicId)
  })
})

describe('conflict awareness is a warning, never a block', () => {
  const saturday8am = '2026-08-08T12:00:00.000Z'

  it('detects an overlapping appointment on the attending rep', () => {
    const conflicts = findAttendeeConflicts(
      [{ id: 'other', scheduled_for: '2026-08-08T12:30:00.000Z', duration_minutes: 60, status: 'scheduled' }],
      { startIso: saturday8am, durationMinutes: 60 }
    )
    expect(conflicts).toHaveLength(1)
    const warning = describeAttendeeConflict(conflicts, 'Nathan Hall')
    expect(warning).toContain('Nathan Hall')
    // The wording must make clear the booking still happened.
    expect(warning).toContain('still booked')
  })

  it('ignores cancelled appointments and the meeting itself', () => {
    expect(
      findAttendeeConflicts(
        [
          { id: 'cancelled-one', scheduled_for: saturday8am, duration_minutes: 60, status: 'cancelled' },
          { id: 'self', scheduled_for: saturday8am, duration_minutes: 60, status: 'scheduled' },
        ],
        { startIso: saturday8am, durationMinutes: 60, excludeAppointmentId: 'self' }
      )
    ).toEqual([])
  })

  it('does not treat back-to-back appointments as a conflict', () => {
    expect(
      findAttendeeConflicts(
        [{ id: 'after', scheduled_for: '2026-08-08T13:00:00.000Z', duration_minutes: 60, status: 'scheduled' }],
        { startIso: saturday8am, durationMinutes: 60 }
      )
    ).toEqual([])
  })

  it('reports no warning when the rep is free', () => {
    expect(describeAttendeeConflict([], 'Nathan Hall')).toBeNull()
  })

  it('has no concept of business hours or availability windows', () => {
    // The adjuster dictates the time. A Saturday 8am with an empty calendar must
    // produce no conflict and therefore nothing that could block the booking.
    expect(findAttendeeConflicts([], { startIso: saturday8am, durationMinutes: 60 })).toEqual([])
  })
})
