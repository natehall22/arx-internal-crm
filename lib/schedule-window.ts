/**
 * The `?start=&end=` window both install-schedule routes accept.
 *
 * This validation was written twice — once in the board route and again in the
 * availability route beside it — which is the point CLAUDE.md's Tesla Algorithm
 * makes about a third copy being a bug rather than a convenience. One home now.
 *
 * Dates are bare `YYYY-MM-DD` throughout: `production_jobs.scheduled_date` is a
 * SQL DATE and installs are all-day, so nothing here may round-trip a date
 * through a local `new Date(str)` — see the header of `lib/install-calendar.ts`
 * for the production bug that rule exists to prevent.
 */

export const MAX_SCHEDULE_WINDOW_DAYS = 90

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value)
}

/**
 * Day count between two `YYYY-MM-DD` strings, from the date parts only.
 *
 * The UTC constructors are safe precisely because both sides are built the same
 * way and the Dates are discarded the moment we have an integer — no calendar
 * date is ever read back out of them.
 */
export function daysBetweenDateOnly(startStr: string, endStr: string): number {
  const [sy, sm, sd] = startStr.split('-').map(Number)
  const [ey, em, ed] = endStr.split('-').map(Number)
  const startUtc = Date.UTC(sy, (sm || 1) - 1, sd || 1)
  const endUtc = Date.UTC(ey, (em || 1) - 1, ed || 1)
  return Math.round((endUtc - startUtc) / 86_400_000)
}

export type ScheduleWindow = { start: string; end: string }

export type ScheduleWindowResult =
  | { ok: true; window: ScheduleWindow }
  | { ok: false; error: string }

/** Validates and bounds the window, returning the same messages both routes already returned. */
export function parseScheduleWindow(params: URLSearchParams): ScheduleWindowResult {
  const start = params.get('start')
  const end = params.get('end')

  if (!isValidDateString(start) || !isValidDateString(end)) {
    return { ok: false, error: 'start and end are required as YYYY-MM-DD' }
  }
  // Safe as a plain string comparison: ISO dates sort lexicographically.
  if (end < start) {
    return { ok: false, error: 'end must not be before start' }
  }
  if (daysBetweenDateOnly(start, end) > MAX_SCHEDULE_WINDOW_DAYS) {
    return { ok: false, error: `Window too large — max ${MAX_SCHEDULE_WINDOW_DAYS} days` }
  }

  return { ok: true, window: { start, end } }
}
