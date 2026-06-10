import { 
  startOfDay, 
  startOfWeek, 
  startOfMonth, 
  startOfQuarter, 
  startOfYear,
  subDays,
  subWeeks,
  subMonths,
  addDays,
} from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

const DEFAULT_TIMEZONE = 'America/New_York'

export interface DateRange {
  start: Date
  end: Date
}

export interface DateRangeDebug extends DateRange {
  timezone: string
  timeframe: string
  startLocal: string
  endLocal: string
  startUtc: string
  endUtc: string
}

/**
 * Get date range for a given timeframe, properly handling timezone conversions.
 * 
 * The logic:
 * 1. Get current time in the target timezone
 * 2. Calculate boundaries in local time (e.g., start of week = Monday 00:00 local)
 * 3. Convert those boundaries back to UTC for database queries
 * 
 * @param timeframe - The timeframe identifier (today, week, month, etc.)
 * @param timezone - IANA timezone string (default: America/New_York)
 * @param debug - If true, logs debug information
 */
export function getDateRangeForTimeFrame(
  timeframe: string,
  timezone: string = DEFAULT_TIMEZONE,
  debug: boolean = false
): DateRange {
  const nowUtc = new Date()
  
  // Convert current UTC time to the target timezone
  const nowLocal = toZonedTime(nowUtc, timezone)
  
  let startLocal: Date
  let endLocal: Date

  switch (timeframe) {
    case 'today':
      // Start of today in local time
      startLocal = startOfDay(nowLocal)
      // End is now (or start of tomorrow for full day)
      endLocal = addDays(startLocal, 1)
      break

    case 'yesterday':
      // Start of yesterday in local time
      startLocal = startOfDay(subDays(nowLocal, 1))
      endLocal = startOfDay(nowLocal)
      break

    case 'week':
      // Start of this week (Sunday) in local time, end = start of tomorrow (partial week).
      // weekStartsOn: 0 = Sunday (matches existing app convention).
      //
      // INTENTIONAL SPLIT: this 'week' case ends at "today" (not Saturday) because
      // rep-facing dashboards and leaderboards show YTW progress, not a full calendar
      // week. Admin accountability uses getCurrentWeekRange() in
      // app/api/admin/sisu/accountability/route.ts which produces a full Sun→Sun
      // exclusive window. Do NOT unify these — they serve different UX needs.
      startLocal = startOfWeek(nowLocal, { weekStartsOn: 0 })
      endLocal = addDays(startOfDay(nowLocal), 1) // Through end of today
      break

    case 'last_week':
      // Start of last week (Sunday) to start of this week
      const thisWeekStart = startOfWeek(nowLocal, { weekStartsOn: 0 })
      startLocal = subWeeks(thisWeekStart, 1)
      endLocal = thisWeekStart
      break

    case 'month':
      // Start of this month in local time
      startLocal = startOfMonth(nowLocal)
      endLocal = addDays(startOfDay(nowLocal), 1)
      break

    case 'last_month':
      // Start of last month to start of this month
      const thisMonthStart = startOfMonth(nowLocal)
      startLocal = startOfMonth(subMonths(nowLocal, 1))
      endLocal = thisMonthStart
      break

    case 'quarter':
      // Start of this quarter in local time
      startLocal = startOfQuarter(nowLocal)
      endLocal = addDays(startOfDay(nowLocal), 1)
      break

    case 'year':
      // Start of this year in local time
      startLocal = startOfYear(nowLocal)
      endLocal = addDays(startOfDay(nowLocal), 1)
      break

    case 'all':
      // All time - use a very early date
      startLocal = new Date(2020, 0, 1, 0, 0, 0, 0)
      endLocal = addDays(startOfDay(nowLocal), 1)
      break

    default:
      // Default to this week (Sunday start)
      startLocal = startOfWeek(nowLocal, { weekStartsOn: 0 })
      endLocal = addDays(startOfDay(nowLocal), 1)
  }

  // Convert local boundaries back to UTC for database queries
  const startUtc = fromZonedTime(startLocal, timezone)
  const endUtc = fromZonedTime(endLocal, timezone)

  if (debug) {
    console.log('[DateRange]', {
      timeframe,
      timezone,
      nowUtc: nowUtc.toISOString(),
      nowLocal: nowLocal.toISOString(),
      startLocal: startLocal.toISOString(),
      endLocal: endLocal.toISOString(),
      startUtc: startUtc.toISOString(),
      endUtc: endUtc.toISOString(),
    })
  }

  return { start: startUtc, end: endUtc }
}

/**
 * Get date range with debug information included in the return value.
 */
export function getDateRangeWithDebug(
  timeframe: string,
  timezone: string = DEFAULT_TIMEZONE
): DateRangeDebug {
  const nowUtc = new Date()
  const nowLocal = toZonedTime(nowUtc, timezone)
  
  const { start, end } = getDateRangeForTimeFrame(timeframe, timezone, false)
  
  // Get the local representations for display
  const startLocal = toZonedTime(start, timezone)
  const endLocal = toZonedTime(end, timezone)

  return {
    start,
    end,
    timezone,
    timeframe,
    startLocal: startLocal.toISOString(),
    endLocal: endLocal.toISOString(),
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  }
}
