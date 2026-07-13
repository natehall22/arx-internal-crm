import { startOfDay, startOfWeek, subDays } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { DateRange } from '@/lib/date-ranges'
import { EASTERN_TZ } from '@/lib/eastern-datetime'

export type MorningUpdateActivityKind = 'yesterday' | 'weekend'

export type MorningUpdateActivityWindow = DateRange & {
  kind: MorningUpdateActivityKind
  /** Short label for the activity subline, e.g. "Friday, July 10, 2026" or "Sat Jul 11 – Sun Jul 12". */
  periodLabel: string
}

function formatLongDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return d.toLocaleDateString('en-US', {
    timeZone: EASTERN_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatShortWeekdayMonthDay(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return d.toLocaleDateString('en-US', {
    timeZone: EASTERN_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatMonthYear(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return d.toLocaleDateString('en-US', {
    timeZone: EASTERN_TZ,
    month: 'long',
    year: 'numeric',
  })
}

/** 0=Sun … 6=Sat in Eastern for an instant. */
export function easternWeekdayForInstant(now: Date = new Date()): number {
  const weekday = now.toLocaleDateString('en-US', { timeZone: EASTERN_TZ, weekday: 'short' })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
}

export function isMondayEastern(now: Date = new Date()): boolean {
  return easternWeekdayForInstant(now) === 1
}

/**
 * Activity window for the morning update.
 * Monday: Sat 00:00 ET → Mon 00:00 ET (covers Sat+Sun; no Sunday email).
 * Other send days: yesterday only.
 */
export function resolveMorningUpdateActivityWindow(now: Date = new Date()): MorningUpdateActivityWindow {
  const nowLocal = toZonedTime(now, EASTERN_TZ)

  if (isMondayEastern(now)) {
    const mondayStartLocal = startOfDay(nowLocal)
    const saturdayStartLocal = startOfDay(subDays(nowLocal, 2))
    const start = fromZonedTime(saturdayStartLocal, EASTERN_TZ)
    const end = fromZonedTime(mondayStartLocal, EASTERN_TZ)
    const sundayStart = fromZonedTime(startOfDay(subDays(nowLocal, 1)), EASTERN_TZ)
    return {
      kind: 'weekend',
      start,
      end,
      periodLabel: `${formatShortWeekdayMonthDay(start)} – ${formatShortWeekdayMonthDay(sundayStart)}`,
    }
  }

  const startLocal = startOfDay(subDays(nowLocal, 1))
  const endLocal = startOfDay(nowLocal)
  const start = fromZonedTime(startLocal, EASTERN_TZ)
  const end = fromZonedTime(endLocal, EASTERN_TZ)
  return {
    kind: 'yesterday',
    start,
    end,
    periodLabel: formatLongDate(start),
  }
}

/** Send-date label (today in Eastern). */
export function resolveMorningUpdateSentDateLabel(now: Date = new Date()): string {
  const nowLocal = toZonedTime(now, EASTERN_TZ)
  const todayStart = fromZonedTime(startOfDay(nowLocal), EASTERN_TZ)
  return formatLongDate(todayStart)
}

export type MorningUpdateLastWeekWindow = DateRange & {
  rangeLabel: string
  monthGoalLabel: string
}

/**
 * Prior completed calendar week (Sun–Sat ET), matching getDateRangeForTimeFrame('last_week').
 * Used only for Monday week-vs-goals.
 */
export function resolveMorningUpdateLastWeekWindow(now: Date = new Date()): MorningUpdateLastWeekWindow {
  const nowLocal = toZonedTime(now, EASTERN_TZ)
  const thisWeekStartLocal = startOfWeek(nowLocal, { weekStartsOn: 0 })
  const lastWeekStartLocal = subDays(thisWeekStartLocal, 7)
  const start = fromZonedTime(lastWeekStartLocal, EASTERN_TZ)
  const end = fromZonedTime(thisWeekStartLocal, EASTERN_TZ)
  const saturday = fromZonedTime(subDays(thisWeekStartLocal, 1), EASTERN_TZ)

  return {
    start,
    end,
    rangeLabel: `${formatShortWeekdayMonthDay(start)} – ${formatShortWeekdayMonthDay(saturday)}`,
    monthGoalLabel: formatMonthYear(fromZonedTime(startOfDay(nowLocal), EASTERN_TZ)),
  }
}

export function shareOfMonthGoalPct(actual: number, goal: number | null | undefined): number | null {
  if (goal == null || goal <= 0) return null
  return Math.round((actual / goal) * 1000) / 10
}
