import { startOfMonth, subMonths } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { getDateRangeForTimeFrame, type DateRange } from '@/lib/date-ranges'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countUserSales } from '@/lib/reporting/period-metrics'

export const SISU_METRICS_TIMEZONE = 'America/New_York'

/** Previous full calendar month (1st 00:00 ET → this month 1st 00:00 ET, exclusive end). */
export function getPreviousFullMonthRange(timezone: string = SISU_METRICS_TIMEZONE): DateRange {
  const nowLocal = toZonedTime(new Date(), timezone)
  const thisMonthStart = startOfMonth(nowLocal)
  const lastMonthStart = startOfMonth(subMonths(nowLocal, 1))
  return {
    start: fromZonedTime(lastMonthStart, timezone),
    end: fromZonedTime(thisMonthStart, timezone),
  }
}

/** Closed sales a person was credited on in a window — read from the reporting view like every other sales number. */
export async function countClosedSalesInRange(db: SupabaseClient, orgId: string, userId: string, range: DateRange): Promise<number> {
  return countUserSales(db, orgId, userId, range)
}

/**
 * Best closed-sales count for badge award: current partial month or last full month.
 * Covers reps who hit threshold at month-end but sync after the new month starts.
 */
export async function countClosedSalesForBadgeAward(
  db: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<number> {
  const [currentMonth, previousMonth] = await Promise.all([
    countClosedSalesInRange(
      db,
      orgId,
      userId,
      getDateRangeForTimeFrame('month', SISU_METRICS_TIMEZONE),
    ),
    countClosedSalesInRange(db, orgId, userId, getPreviousFullMonthRange()),
  ])
  return Math.max(currentMonth, previousMonth)
}
