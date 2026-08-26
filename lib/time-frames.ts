/**
 * The timeframe options every "filter by period" picker offers, in display order.
 *
 * SINGLE SOURCE OF TRUTH — the dashboard picker, the Sisu leaderboard picker and
 * the API routes that validate `?timeframe=` all read from this list. Adding an
 * option here must also be handled in `getDateRangeForTimeFrame`
 * (lib/date-ranges.ts), which turns a timeframe into a UTC window.
 *
 * Deliberately dependency-free (no date-fns) so client bundles that only need
 * the option list do not pull the date library in.
 */
export const TIME_FRAMES = [
  'today',
  'yesterday',
  'week',
  'last_week',
  'month',
  'last_month',
  'quarter',
  'year',
  'all',
  'custom',
] as const

export type TimeFrame = (typeof TIME_FRAMES)[number]

/** Labels for the `<option>` elements of a timeframe picker. */
export const TIME_FRAME_SELECT_LABELS: Record<TimeFrame, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This Week',
  last_week: 'Last Week',
  month: 'This Month',
  last_month: 'Last Month',
  quarter: 'This Quarter',
  year: 'This Year',
  all: 'All Time',
  custom: 'Custom Range',
}

/** Lowercase prose labels, for use mid-sentence ("your pace for this week"). */
export const TIME_FRAME_PROSE_LABELS: Record<Exclude<TimeFrame, 'custom'>, string> = {
  today: 'today',
  yesterday: 'yesterday',
  week: 'this week',
  last_week: 'last week',
  month: 'this month',
  last_month: 'last month',
  quarter: 'this quarter',
  year: 'this year',
  all: 'all time',
}

export function isTimeFrame(value: unknown): value is TimeFrame {
  return typeof value === 'string' && (TIME_FRAMES as readonly string[]).includes(value)
}

/**
 * True for a plain `YYYY-MM-DD` calendar date that actually exists.
 * Guards `getCustomDateRange` against an `Invalid Date` reaching the DB layer.
 */
export function isCalendarDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(y, m - 1, d)
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
}
