import { addDaysToDateOnly, buildInstallEvent } from '@/lib/install-calendar'

/**
 * Pure-function tests only — no network. `buildInstallEvent` and
 * `addDaysToDateOnly` do no I/O, so these pin the two properties the file
 * header calls out as the highest-risk parts of install scheduling:
 *
 *   1. Google's all-day `end.date` is EXCLUSIVE — a 1-day install's end date
 *      is start+1, a 2-day install's is start+2.
 *   2. `scheduled_date` must reach Google as the *exact* `YYYY-MM-DD` string
 *      it started as, with no shift from a `new Date(str)` + `toISOString()`
 *      round-trip (which reinterprets the date as UTC midnight and can print
 *      a different local calendar day depending on the process timezone).
 */

describe('addDaysToDateOnly', () => {
  it('adds one day for a 1-day install', () => {
    expect(addDaysToDateOnly('2026-09-10', 1)).toBe('2026-09-11')
  })

  it('adds two days for a 2-day install', () => {
    expect(addDaysToDateOnly('2026-09-10', 2)).toBe('2026-09-12')
  })

  it('rolls over a month boundary correctly', () => {
    expect(addDaysToDateOnly('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('does not shift across the US spring-forward DST boundary (2026-03-08)', () => {
    // A naive `new Date('2026-03-08').toISOString()` round-trip is exactly the
    // kind of bug this guards against: parsed as UTC midnight, formatted back
    // in a negative-UTC-offset timezone, it can print as 2026-03-07.
    expect(addDaysToDateOnly('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDaysToDateOnly('2026-03-08', 2)).toBe('2026-03-10')
  })

  it('does not shift around a new year boundary (2026-01-01)', () => {
    expect(addDaysToDateOnly('2026-01-01', 1)).toBe('2026-01-02')
    expect(addDaysToDateOnly('2025-12-31', 1)).toBe('2026-01-01')
  })
})

describe('buildInstallEvent', () => {
  const base = {
    jobId: 'job-1',
    jobNumber: '26-0099',
    customerName: 'Jane Homeowner',
    addressText: '123 Main St, Charlotte, NC',
    scheduledDate: '2026-09-10',
  }

  it('emits a 1-day install as start=date, end=date+1', () => {
    const event = buildInstallEvent({ ...base, installDays: 1 })
    expect(event.start).toEqual({ date: '2026-09-10' })
    expect(event.end).toEqual({ date: '2026-09-11' })
  })

  it('treats a null/undefined installDays as 1 day', () => {
    const eventNull = buildInstallEvent({ ...base, installDays: null })
    expect(eventNull.end).toEqual({ date: '2026-09-11' })

    const eventUndefined = buildInstallEvent({ ...base })
    expect(eventUndefined.end).toEqual({ date: '2026-09-11' })
  })

  it('emits a 2-day install as start=date, end=date+2', () => {
    const event = buildInstallEvent({ ...base, installDays: 2 })
    expect(event.start).toEqual({ date: '2026-09-10' })
    expect(event.end).toEqual({ date: '2026-09-12' })
  })

  it('emits the scheduled date verbatim across a DST boundary (2026-03-08)', () => {
    const event = buildInstallEvent({ ...base, scheduledDate: '2026-03-08', installDays: 1 })
    expect(event.start).toEqual({ date: '2026-03-08' })
    expect(event.end).toEqual({ date: '2026-03-09' })
  })

  it('emits the scheduled date verbatim on a new year boundary (2026-01-01)', () => {
    const event = buildInstallEvent({ ...base, scheduledDate: '2026-01-01', installDays: 2 })
    expect(event.start).toEqual({ date: '2026-01-01' })
    expect(event.end).toEqual({ date: '2026-01-03' })
  })

  it('includes the sub as an attendee when scheduling_email is set', () => {
    const event = buildInstallEvent({ ...base, schedulingEmail: 'sub@example.com' })
    expect(event.attendees).toEqual([{ email: 'sub@example.com' }])
  })

  it('lowercases and trims the scheduling email', () => {
    const event = buildInstallEvent({ ...base, schedulingEmail: '  Sub@Example.com  ' })
    expect(event.attendees).toEqual([{ email: 'sub@example.com' }])
  })

  it('omits attendees when scheduling_email is null', () => {
    const event = buildInstallEvent({ ...base, schedulingEmail: null })
    expect(event.attendees).toBeUndefined()
  })

  it('omits attendees when scheduling_email is undefined', () => {
    const event = buildInstallEvent({ ...base })
    expect(event.attendees).toBeUndefined()
  })

  it('omits attendees when scheduling_email is blank', () => {
    const event = buildInstallEvent({ ...base, schedulingEmail: '   ' })
    expect(event.attendees).toBeUndefined()
  })

  it('builds a summary with job number and customer name', () => {
    const event = buildInstallEvent({ ...base })
    expect(event.summary).toBe('Install — 26-0099 — Jane Homeowner')
  })

  it('uses the job address as the event location', () => {
    const event = buildInstallEvent({ ...base })
    expect(event.location).toBe('123 Main St, Charlotte, NC')
  })

  it('omits location when the job has no address', () => {
    const event = buildInstallEvent({ ...base, addressText: null })
    expect(event.location).toBeUndefined()
  })

  it('includes job number, squares, and a job page link in the description', () => {
    const event = buildInstallEvent({ ...base, totalSquares: 28.5 })
    expect(event.description).toContain('Job #: 26-0099')
    expect(event.description).toContain('Squares: 28.5')
    expect(event.description).toContain('/ops/jobs/job-1')
  })

  it('omits the squares line when squares are unknown', () => {
    const event = buildInstallEvent({ ...base, totalSquares: null })
    expect(event.description).not.toContain('Squares:')
  })
})

/**
 * Notification + stale-event regression cover.
 *
 * Google defaults `sendUpdates` to `none` on events.patch AND events.delete, so
 * without an explicit 'all' the sub is emailed exactly once — on create — and
 * never hears about a reschedule, a reassignment, or a cancellation. That is the
 * single failure the attendee design exists to prevent.
 */
describe('install calendar notification contract', () => {
  const CREATED = { id: 'evt-1' }

  function fakeFetch(calls: { url: string; method: string }[], status = 200) {
    return jest.fn(async (input: unknown, init?: { method?: string }) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => CREATED,
        text: async () => '',
      } as unknown as Response
    })
  }

  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  it('asks Google to notify attendees when an existing event is patched', async () => {
    const calls: { url: string; method: string }[] = []
    global.fetch = fakeFetch(calls) as unknown as typeof global.fetch

    const { updateCalendarEvent } = await import('@/lib/google-calendar')
    const { INSTALL_SEND_UPDATES } = await import('@/lib/install-calendar')
    await updateCalendarEvent('tok', 'evt-1', { summary: 'x' }, 'primary', INSTALL_SEND_UPDATES)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].url).toContain('sendUpdates=all')
  })

  it('asks Google to notify attendees when an event is cancelled', async () => {
    const calls: { url: string; method: string }[] = []
    global.fetch = fakeFetch(calls, 204) as unknown as typeof global.fetch

    const { deleteCalendarEvent } = await import('@/lib/google-calendar')
    const { INSTALL_SEND_UPDATES } = await import('@/lib/install-calendar')
    await deleteCalendarEvent('tok', 'evt-1', 'primary', INSTALL_SEND_UPDATES)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].url).toContain('sendUpdates=all')
  })

  it('defaults to notifying nobody, so existing callers are unchanged', async () => {
    const calls: { url: string; method: string }[] = []
    global.fetch = fakeFetch(calls) as unknown as typeof global.fetch

    const { updateCalendarEvent } = await import('@/lib/google-calendar')
    await updateCalendarEvent('tok', 'evt-1', { summary: 'x' })

    expect(calls[0].url).not.toContain('sendUpdates')
  })

  it('treats a 404 on update as a stale id the caller can recover from', async () => {
    const calls: { url: string; method: string }[] = []
    global.fetch = fakeFetch(calls, 404) as unknown as typeof global.fetch

    const { updateCalendarEvent, isMissingEventError } = await import('@/lib/google-calendar')
    // Without this, a hand-deleted Google event wedges that job's sync forever:
    // the dead id is retried on every reschedule and never cleared.
    let caught: unknown
    try {
      await updateCalendarEvent('tok', 'gone', { summary: 'x' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeDefined()
    expect(isMissingEventError(caught)).toBe(true)
    // A non-missing failure must NOT be mistaken for a stale id.
    expect(isMissingEventError(new Error('boom'))).toBe(false)
  })
})
