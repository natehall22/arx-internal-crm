import { startOfMonth, subMonths } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { getDateRangeForTimeFrame, type DateRange } from '@/lib/date-ranges'
import {
  SALE_AGREEMENT_TYPES,
  getAttributedInstallationSales,
  type InstallationSaleContractRow,
} from '@/lib/sales-metrics'

export const SISU_METRICS_TIMEZONE = 'America/New_York'

type QueryResult = {
  data: unknown
  error: { message: string } | null
}

type ClosedSalesFilter = {
  eq: (column: string, value: unknown) => ClosedSalesFilter
  in: (column: string, values: readonly unknown[]) => ClosedSalesFilter
  not: (column: string, operator: string, value: unknown) => ClosedSalesFilter
  gte: (column: string, value: unknown) => ClosedSalesFilter
  lt: (column: string, value: unknown) => PromiseLike<QueryResult>
}

type ClosedSalesQuery = {
  select: (columns: string) => ClosedSalesFilter
}

type ClosedSalesDb = {
  from: (table: string) => ClosedSalesQuery
}

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

export function countUserClosedSalesFromRows(
  rows: InstallationSaleContractRow[] | null | undefined,
  userId: string,
): number {
  const salesOpportunities = getAttributedInstallationSales(rows)
  return new Set(
    salesOpportunities
      .filter((o) => o.setter_user_id === userId || o.owner_user_id === userId)
      .map((o) => o.opportunity_id || o.id),
  ).size
}

export async function countClosedSalesInRange(
  db: unknown,
  orgId: string,
  userId: string,
  range: DateRange,
): Promise<number> {
  const typedDb = db as ClosedSalesDb
  const { data, error } = await typedDb
    .from('order_form_contracts')
    .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
    .eq('org_id', orgId)
    .in('agreement_type', SALE_AGREEMENT_TYPES)
    .eq('status', 'completed')
    .not('customer_signed_at', 'is', null)
    .gte('customer_signed_at', range.start.toISOString())
    .lt('customer_signed_at', range.end.toISOString())

  if (error) throw new Error(error.message)
  return countUserClosedSalesFromRows(data as InstallationSaleContractRow[] | null, userId)
}

/**
 * Best closed-sales count for badge award: current partial month or last full month.
 * Covers reps who hit threshold at month-end but sync after the new month starts.
 */
export async function countClosedSalesForBadgeAward(
  db: unknown,
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
