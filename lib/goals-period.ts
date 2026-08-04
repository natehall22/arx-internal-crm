import { addDays, startOfDay } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { EASTERN_TZ, getEasternTodayIso } from '@/lib/eastern-datetime'

export { EASTERN_TZ as GOALS_TIMEZONE }

/** Parse YYYY-MM to first-of-month date string. */
export function normalizeGoalMonth(month: string): string {
  const trimmed = month.trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed.slice(0, 7)}-01`
  throw new Error('Invalid month; expected YYYY-MM')
}

/** Exclusive UTC bounds for a calendar month in Eastern Time. */
export function getEasternMonthRange(month: string): { startIso: string; endIso: string; monthStart: string } {
  const monthStart = normalizeGoalMonth(month)
  const [y, m] = monthStart.split('-').map(Number)
  const startLocal = new Date(y, m - 1, 1, 0, 0, 0, 0)
  const endLocal = new Date(y, m, 1, 0, 0, 0, 0)
  return {
    monthStart,
    startIso: fromZonedTime(startLocal, EASTERN_TZ).toISOString(),
    endIso: fromZonedTime(endLocal, EASTERN_TZ).toISOString(),
  }
}

/** Inclusive calendar-date range [start, end] in Eastern → exclusive UTC end. */
export function getEasternDateRange(startDate: string, endDate: string): { startIso: string; endIso: string } {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const startLocal = new Date(sy, sm - 1, sd, 0, 0, 0, 0)
  const endLocal = addDays(new Date(ey, em - 1, ed, 0, 0, 0, 0), 1)
  return {
    startIso: fromZonedTime(startLocal, EASTERN_TZ).toISOString(),
    endIso: fromZonedTime(endLocal, EASTERN_TZ).toISOString(),
  }
}

export function getPreviousMonthIso(fromMonth?: string): string {
  return addGoalMonths(fromMonth ?? getEasternTodayIso().slice(0, 7), -1)
}

export function getCurrentMonthIso(): string {
  return getEasternTodayIso().slice(0, 7)
}

export function isPastGoalMonth(month: string): boolean {
  return normalizeGoalMonth(month).slice(0, 7) < getCurrentMonthIso()
}

/** ET calendar date YYYY-MM-DD for a UTC instant. */
export function toEasternDateIso(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('en-CA', { timeZone: EASTERN_TZ })
}

/** 0=Sun … 6=Sat in Eastern for a UTC instant. */
export function easternWeekdayIndex(iso: string | Date): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const weekday = d.toLocaleDateString('en-US', { timeZone: EASTERN_TZ, weekday: 'short' })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
}

/** List ET calendar dates from start (inclusive) to end (exclusive). */
export function listEasternDatesInRange(startIso: string, endIso: string): string[] {
  const dates: string[] = []
  let cursor = startOfDay(toZonedTime(new Date(startIso), EASTERN_TZ))
  const end = toZonedTime(new Date(endIso), EASTERN_TZ)
  while (cursor < end) {
    dates.push(
      cursor.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    )
    cursor = addDays(cursor, 1)
  }
  return dates
}

/** Inclusive whole-day count between two YYYY-MM-DD strings. */
export function countInclusiveDays(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  // UTC arithmetic on bare calendar dates — no wall-clock involved, so DST can't skew it.
  const start = Date.UTC(sy, sm - 1, sd)
  const end = Date.UTC(ey, em - 1, ed)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) / 86_400_000) + 1
}

/** Last calendar date (YYYY-MM-DD) of the given YYYY-MM, in Eastern. */
export function getEasternMonthEndDate(month: string): string {
  const { endIso } = getEasternMonthRange(month)
  // Step back half a day rather than a full day so a DST transition on the 1st
  // can't land us on the second-to-last date of the month.
  return toEasternDateIso(new Date(new Date(endIso).getTime() - 43_200_000))
}

/** Add `delta` calendar months to a YYYY-MM, returning YYYY-MM. */
export function addGoalMonths(month: string, delta: number): string {
  const [y, m] = normalizeGoalMonth(month).split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Every YYYY-MM that overlaps an inclusive Eastern date range. Goals are stored per
 * calendar month, so a forecast range spanning months has to gather (and prorate)
 * each one — see `fetchGoalsForRange`.
 */
export function listGoalMonthsInRange(startDate: string, endDate: string): string[] {
  const first = startDate.slice(0, 7)
  const last = endDate.slice(0, 7)
  if (last < first) return []
  const months: string[] = []
  let cursor = first
  // Guard against a pathological range producing an unbounded loop.
  while (cursor <= last && months.length < 120) {
    months.push(cursor)
    cursor = addGoalMonths(cursor, 1)
  }
  return months
}

/** Calendar quarter containing `today` (ET), as inclusive date strings. */
export function getEasternQuarterRange(today = getEasternTodayIso()): {
  start: string
  end: string
} {
  const [y, m] = today.split('-').map(Number)
  const quarterFirstMonth = Math.floor((m - 1) / 3) * 3 + 1
  const startMonth = `${y}-${String(quarterFirstMonth).padStart(2, '0')}`
  return getQuarterRangeFromFirstMonth(startMonth)
}

function getQuarterRangeFromFirstMonth(firstMonth: string): { start: string; end: string } {
  return { start: `${firstMonth}-01`, end: getEasternMonthEndDate(addGoalMonths(firstMonth, 2)) }
}

export type ForecastPreset = 'mtd' | 'this_quarter' | 'last_vs_this_quarter'

/**
 * Forecast ranges run to the END of the period, not to today — the whole point is to
 * project the rest of the period against a target set for that whole period. (The
 * dashboard's `getDateRangeForTimeFrame('month'|'quarter')` helpers are to-DATE
 * ranges and must not be used here.)
 */
export function getForecastPresetRange(
  preset: ForecastPreset,
  today = getEasternTodayIso()
): { start: string; end: string; compareStart?: string; compareEnd?: string } {
  if (preset === 'mtd') {
    const month = today.slice(0, 7)
    return { start: `${month}-01`, end: getEasternMonthEndDate(month) }
  }

  const thisQuarter = getEasternQuarterRange(today)
  if (preset === 'this_quarter') return thisQuarter

  const lastQuarter = getQuarterRangeFromFirstMonth(addGoalMonths(thisQuarter.start.slice(0, 7), -3))
  return {
    ...thisQuarter,
    compareStart: lastQuarter.start,
    compareEnd: lastQuarter.end,
  }
}
