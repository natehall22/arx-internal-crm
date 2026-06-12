import { startOfWeek, subWeeks } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { getDateRangeForTimeFrame, type DateRange } from '@/lib/date-ranges'

export const SISU_WEEKLY_TIMEZONE = 'America/New_York'

type DoorCountRow = {
  owner_id: string
  cnt: number | string
}

type RpcResult = {
  data: unknown
  error: { message: string } | null
}

type SisuDoorsAdmin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>
}

/** Previous full calendar week (Sun 00:00 ET → this Sun 00:00 ET, exclusive end). */
export function getPreviousFullWeekRange(timezone: string = SISU_WEEKLY_TIMEZONE): DateRange {
  const nowLocal = toZonedTime(new Date(), timezone)
  const thisSundayLocal = startOfWeek(nowLocal, { weekStartsOn: 0 })
  const lastSundayLocal = subWeeks(thisSundayLocal, 1)
  return {
    start: fromZonedTime(lastSundayLocal, timezone),
    end: fromZonedTime(thisSundayLocal, timezone),
  }
}

async function countDoorsKnockedInRange(
  admin: SisuDoorsAdmin,
  orgId: string,
  userId: string,
  range: DateRange,
): Promise<number> {
  const { data, error } = await admin.rpc('dashboard_door_leads_by_owner', {
    p_org_id: orgId,
    p_start: range.start.toISOString(),
    p_end: range.end.toISOString(),
    p_member_ids: [userId],
  })

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as DoorCountRow[]
  const row = rows.find((r) => r.owner_id === userId)
  const count = Number(row?.cnt ?? 0)
  return Number.isFinite(count) ? count : 0
}

/**
 * Current-week doors — matches Sisu page + leaderboard (partial week through today ET).
 */
export async function countWeeklyDoorsKnockedForUser(
  admin: SisuDoorsAdmin,
  orgId: string,
  userId: string,
): Promise<number> {
  const range = getDateRangeForTimeFrame('week', SISU_WEEKLY_TIMEZONE)
  return countDoorsKnockedInRange(admin, orgId, userId, range)
}

/**
 * Best door count for badge award checks: current partial week or last full week.
 * Covers reps who hit threshold before the Sunday reset but sync after the new week starts.
 */
export async function countDoorsKnockedForBadgeAward(
  admin: SisuDoorsAdmin,
  orgId: string,
  userId: string,
): Promise<number> {
  const [currentWeek, previousWeek] = await Promise.all([
    countDoorsKnockedInRange(admin, orgId, userId, getDateRangeForTimeFrame('week', SISU_WEEKLY_TIMEZONE)),
    countDoorsKnockedInRange(admin, orgId, userId, getPreviousFullWeekRange()),
  ])
  return Math.max(currentWeek, previousWeek)
}
