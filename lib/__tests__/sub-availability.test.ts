import {
  busyDatesFromSlots,
  resolveSubCalendarId,
  resolveSubShareStatus,
} from '@/lib/sub-availability'

/**
 * Pure-function tests only — no network. Mirrors the style of
 * `lib/__tests__/install-calendar.test.ts`.
 *
 * `busyDatesFromSlots` is the highest-risk part of this file: it turns a
 * Google free/busy RFC3339 instant (WITH an offset) into a bare calendar
 * date, which is the exact class of bug `lib/install-calendar.ts`'s header
 * documents already shipped once in this codebase (a `new Date(str)` +
 * `toISOString()` round-trip, or a hardcoded non-business timezone). Every
 * date here is pinned against `CALENDAR_BUSINESS_TZ` ('America/New_York').
 */

describe('resolveSubCalendarId', () => {
  it('prefers scheduling_calendar_id when set', () => {
    expect(
      resolveSubCalendarId({
        scheduling_calendar_id: 'crew@sharedcal.com',
        scheduling_email: 'crew@gmail.com',
      })
    ).toBe('crew@sharedcal.com')
  })

  it('falls back to scheduling_email when scheduling_calendar_id is null', () => {
    expect(
      resolveSubCalendarId({ scheduling_calendar_id: null, scheduling_email: 'crew@gmail.com' })
    ).toBe('crew@gmail.com')
  })

  it('falls back to scheduling_email when scheduling_calendar_id is missing entirely', () => {
    expect(resolveSubCalendarId({ scheduling_email: 'crew@gmail.com' })).toBe('crew@gmail.com')
  })

  it('falls back to scheduling_email when scheduling_calendar_id is blank/whitespace', () => {
    expect(
      resolveSubCalendarId({ scheduling_calendar_id: '   ', scheduling_email: 'crew@gmail.com' })
    ).toBe('crew@gmail.com')
  })

  it('returns null when neither is set', () => {
    expect(resolveSubCalendarId({ scheduling_calendar_id: null, scheduling_email: null })).toBeNull()
  })

  it('returns null when both are blank', () => {
    expect(resolveSubCalendarId({ scheduling_calendar_id: '  ', scheduling_email: '  ' })).toBeNull()
  })

  it('returns null for a null/undefined sub', () => {
    expect(resolveSubCalendarId(null)).toBeNull()
    expect(resolveSubCalendarId(undefined)).toBeNull()
  })
})

describe('busyDatesFromSlots', () => {
  const WINDOW_START = '2026-09-01'
  const WINDOW_END = '2026-09-30'

  it('marks a normal daytime slot on its own single date', () => {
    const slots = [{ start: '2026-09-10T09:00:00-04:00', end: '2026-09-10T17:00:00-04:00' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-10'])
  })

  it('marks BOTH dates for a slot that crosses midnight', () => {
    const slots = [{ start: '2026-09-10T23:00:00-04:00', end: '2026-09-11T01:00:00-04:00' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-10', '2026-09-11'])
  })

  it('excludes a slot entirely outside the window', () => {
    const slots = [{ start: '2026-08-15T09:00:00-04:00', end: '2026-08-15T17:00:00-04:00' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual([])
  })

  it('clips a slot that partially overlaps the window to only the in-window date', () => {
    // Starts the evening before the window opens, crosses into day 1 of the window.
    const slots = [{ start: '2026-08-31T22:00:00-04:00', end: '2026-09-01T01:00:00-04:00' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-01'])
  })

  it('does NOT roll into the next day when the busy range ends exactly at local midnight', () => {
    // Google's busy end is exclusive — a range ending at 00:00:00 local doesn't
    // actually touch the following calendar day.
    const slots = [{ start: '2026-09-10T22:00:00-04:00', end: '2026-09-11T00:00:00-04:00' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-10'])
  })

  it('keeps a late-evening Eastern slot on the correct day when Google reports it in UTC', () => {
    // 2026-09-11T02:30:00Z is 2026-09-10T22:30:00 Eastern (EDT, UTC-4). A naive
    // conversion that lifts the bare date straight off the UTC string (or off a
    // `new Date(...).toISOString()` round-trip) would wrongly report 2026-09-11 —
    // exactly the double-timezone bug this file's header calls out.
    const slots = [{ start: '2026-09-11T02:30:00Z', end: '2026-09-11T03:00:00Z' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-10'])
  })

  it('keeps an early-morning Eastern slot on the correct day when Google reports it in UTC', () => {
    // 2026-09-10T04:15:00Z is 2026-09-10T00:15:00 Eastern — just after local
    // midnight. A naive UTC-date read would still say 2026-09-10 here (by
    // coincidence), but pin it anyway so the pair of tests brackets both sides.
    const slots = [{ start: '2026-09-10T04:15:00Z', end: '2026-09-10T04:45:00Z' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-10'])
  })

  it('dedupes overlapping slots that land on the same date', () => {
    const slots = [
      { start: '2026-09-10T09:00:00-04:00', end: '2026-09-10T10:00:00-04:00' },
      { start: '2026-09-10T14:00:00-04:00', end: '2026-09-10T15:00:00-04:00' },
    ]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-10'])
  })

  it('sorts the returned dates', () => {
    const slots = [
      { start: '2026-09-20T09:00:00-04:00', end: '2026-09-20T10:00:00-04:00' },
      { start: '2026-09-05T09:00:00-04:00', end: '2026-09-05T10:00:00-04:00' },
    ]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual(['2026-09-05', '2026-09-20'])
  })

  it('spans multiple full days for a multi-day busy block', () => {
    const slots = [{ start: '2026-09-10T09:00:00-04:00', end: '2026-09-12T17:00:00-04:00' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ])
  })

  it('ignores a degenerate slot where end is not after start', () => {
    const slots = [{ start: '2026-09-10T09:00:00-04:00', end: '2026-09-10T09:00:00-04:00' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual([])
  })

  it('ignores an unparseable slot rather than throwing', () => {
    const slots = [{ start: 'not-a-date', end: 'also-not-a-date' }]
    expect(busyDatesFromSlots(slots, WINDOW_START, WINDOW_END)).toEqual([])
  })

  it('returns an empty array for no slots', () => {
    expect(busyDatesFromSlots([], WINDOW_START, WINDOW_END)).toEqual([])
  })

  it('throws if windowStart/windowEnd are not bare YYYY-MM-DD strings', () => {
    expect(() => busyDatesFromSlots([], '2026-09-01T00:00:00Z', WINDOW_END)).toThrow()
    expect(() => busyDatesFromSlots([], WINDOW_START, 'garbage')).toThrow()
  })
})

describe('resolveSubShareStatus', () => {
  it('is not_configured when the sub has no calendar id at all', () => {
    expect(resolveSubShareStatus(null, { busy: [] })).toBe('not_configured')
  })

  it('is error when a calendar id was resolved but nothing came back for it', () => {
    // e.g. the whole getFreeBusyForCalendars call threw and no per-calendar
    // result exists — must not be silently treated as free.
    expect(resolveSubShareStatus('sub@example.com', undefined)).toBe('error')
  })

  it('is ok when Google returns busy data with no error, even if empty (genuinely free)', () => {
    expect(resolveSubShareStatus('sub@example.com', { busy: [] })).toBe('ok')
  })

  it('is ok when Google returns actual busy blocks', () => {
    expect(
      resolveSubShareStatus('sub@example.com', {
        busy: [{ start: '2026-09-10T09:00:00-04:00', end: '2026-09-10T17:00:00-04:00' }],
      })
    ).toBe('ok')
  })

  it('is not_shared for a notFound error — the calendar was never shared with us', () => {
    expect(resolveSubShareStatus('sub@example.com', { error: 'notFound' })).toBe('not_shared')
  })

  it('is not_shared for a forbidden error — access was revoked', () => {
    expect(resolveSubShareStatus('sub@example.com', { error: 'forbidden' })).toBe('not_shared')
  })

  it('is error (never not_shared, never ok) for an unrecognized Google error reason', () => {
    expect(resolveSubShareStatus('sub@example.com', { error: 'rateLimitExceeded' })).toBe('error')
    expect(resolveSubShareStatus('sub@example.com', { error: 'no_response' })).toBe('error')
  })
})
