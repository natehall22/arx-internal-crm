/**
 * Calendar uses America/New_York for DB range queries and for placing events in day/hour cells.
 * Scheduled times are stored as timestamptz; scheduling in the app is Eastern; this avoids empty
 * week/month views when the browser is in another timezone.
 */
import {
  addDays,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

export const CALENDAR_BUSINESS_TZ = 'America/New_York'

export function ymdInBusinessTz(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'yyyy-MM-dd')
}

export function hourInBusinessTz(iso: string | Date): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return parseInt(formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'H'), 10)
}

export function minutesInBusinessTz(iso: string | Date): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return parseInt(formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'm'), 10)
}

export function nyWeekRangeUtc(anchor: Date): { start: Date; end: Date } {
  const ny = toZonedTime(anchor, CALENDAR_BUSINESS_TZ)
  const sun = startOfWeek(startOfDay(ny), { weekStartsOn: 0 })
  const sat = addDays(sun, 6)
  return {
    start: fromZonedTime(startOfDay(sun), CALENDAR_BUSINESS_TZ),
    end: fromZonedTime(endOfDay(sat), CALENDAR_BUSINESS_TZ),
  }
}

export function nyDayRangeUtc(anchor: Date): { start: Date; end: Date } {
  const ny = toZonedTime(anchor, CALENDAR_BUSINESS_TZ)
  return {
    start: fromZonedTime(startOfDay(ny), CALENDAR_BUSINESS_TZ),
    end: fromZonedTime(endOfDay(ny), CALENDAR_BUSINESS_TZ),
  }
}

export function nyMonthRangeUtc(anchor: Date): { start: Date; end: Date } {
  const ny = toZonedTime(anchor, CALENDAR_BUSINESS_TZ)
  const first = startOfMonth(ny)
  const last = endOfMonth(ny)
  return {
    start: fromZonedTime(startOfDay(first), CALENDAR_BUSINESS_TZ),
    end: fromZonedTime(endOfDay(last), CALENDAR_BUSINESS_TZ),
  }
}

/** Next N days from anchor's calendar day in NY (inclusive start). */
export function nyAgendaRangeUtc(anchor: Date, days: number): { start: Date; end: Date } {
  const ny = toZonedTime(anchor, CALENDAR_BUSINESS_TZ)
  const startNy = startOfDay(ny)
  const endNy = endOfDay(addDays(startNy, days))
  return {
    start: fromZonedTime(startNy, CALENDAR_BUSINESS_TZ),
    end: fromZonedTime(endNy, CALENDAR_BUSINESS_TZ),
  }
}

/** Seven UTC instants representing Sun–Sat midnights in Eastern for the NY week containing anchor. */
export function nyWeekDayDates(anchor: Date): Date[] {
  const ny = toZonedTime(anchor, CALENDAR_BUSINESS_TZ)
  const sun = startOfWeek(startOfDay(ny), { weekStartsOn: 0 })
  return Array.from({ length: 7 }, (_, i) =>
    fromZonedTime(startOfDay(addDays(sun, i)), CALENDAR_BUSINESS_TZ)
  )
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** First/last calendar day in the 6×7 month grid (NY), same math as the grid cells. */
function nyMonthGridBounds(anchor: Date): { gridStart: Date; gridEnd: Date } {
  const ny = toZonedTime(anchor, CALENDAR_BUSINESS_TZ)
  const firstOfMonth = startOfMonth(ny)
  const wdName = formatInTimeZone(firstOfMonth, CALENDAR_BUSINESS_TZ, 'EEEE')
  const dow = WEEKDAY_NAMES.indexOf(wdName)
  const gridStart = subDays(firstOfMonth, dow === -1 ? 0 : dow)
  const gridEnd = addDays(gridStart, 41)
  return { gridStart, gridEnd }
}

/** 6×7 grid for month view; days are UTC instants for NY calendar cells. */
export function nyMonthCalendarDays(anchor: Date): Date[] {
  const { gridStart, gridEnd } = nyMonthGridBounds(anchor)
  return eachDayOfInterval({ start: gridStart, end: gridEnd })
}

/**
 * UTC range covering every day visible in month view (including padding from prev/next month).
 * Derived from the same day cells as the grid so `getAppointmentsForDay` always finds fetched rows.
 */
export function nyMonthGridRangeUtc(anchor: Date): { start: Date; end: Date } {
  const days = nyMonthCalendarDays(anchor)
  if (days.length === 0) return nyMonthRangeUtc(anchor)
  const firstYmd = ymdInBusinessTz(days[0])
  const lastYmd = ymdInBusinessTz(days[days.length - 1])
  return {
    start: fromZonedTime(`${firstYmd}T00:00:00`, CALENDAR_BUSINESS_TZ),
    end: fromZonedTime(`${lastYmd}T23:59:59.999`, CALENDAR_BUSINESS_TZ),
  }
}

export function nyMonthKey(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'yyyy-MM')
}

export function formatNyWeekdayShort(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'EEE')
}

export function formatNyDayOfMonth(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'd')
}

export function formatNyMonthYearTitle(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'MMMM yyyy')
}

/** Long date line for day view header (matches ymd used for slots). */
export function formatNyLongDate(d: Date): string {
  return formatInTimeZone(d, CALENDAR_BUSINESS_TZ, 'EEEE, MMMM d, yyyy')
}

/** 0–23 Eastern hour → 12 AM … 11 PM label */
export function formatEasternHourLabel(hour24: number): string {
  if (hour24 === 0) return '12 AM'
  if (hour24 < 12) return `${hour24} AM`
  if (hour24 === 12) return '12 PM'
  return `${hour24 - 12} PM`
}
