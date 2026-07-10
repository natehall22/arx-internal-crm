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
  const base = fromMonth ?? getEasternTodayIso().slice(0, 7)
  const [y, m] = base.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

export function countRemainingWeeks(asOfIso: string, rangeEndIso: string): number {
  const dates = listEasternDatesInRange(asOfIso, rangeEndIso)
  if (dates.length === 0) return 0
  return Math.max(1, Math.ceil(dates.length / 7))
}
