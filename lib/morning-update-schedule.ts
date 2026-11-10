import { toZonedTime } from 'date-fns-tz'
import { EASTERN_TZ } from '@/lib/eastern-datetime'

/** First fire of the morning: 5:28am ET, a couple of minutes of slack before 5:30. */
const WINDOW_OPEN_MINUTES = 5 * 60 + 28
/** Last minute a retry may still deliver. Past this the update is stale enough to skip the day. */
const WINDOW_CLOSE_MINUTES = 8 * 60 + 59

/**
 * True when the company's local time (`orgs.timezone`, default Eastern) is Mon–Sat between 5:28am and
 * 8:59am. The Vercel cron fires at :30 past 9–13 UTC, which puts a fire at 5:30am local for every
 * continental US zone in both standard and daylight time (Eastern 9/10, Central 10/11, Mountain 11/12,
 * Pacific 12/13 UTC); the other fires that land inside a company's window are retries.
 *
 * The window is wide on purpose: the first fire is the intended 5:30am send and the rest are
 * retries for when it fails (a Supabase 503 ate the 2026-08-14 send outright). Only one email
 * per day actually goes out — `claimDailyBlast` in lib/email-blast-ledger is what enforces that.
 */
export function isMorningUpdateSendWindow(now: Date = new Date(), timeZone: string = EASTERN_TZ): boolean {
  const nowLocal = toZonedTime(now, timeZone)
  if (nowLocal.getDay() === 0) return false
  const minutes = nowLocal.getHours() * 60 + nowLocal.getMinutes()
  return minutes >= WINDOW_OPEN_MINUTES && minutes <= WINDOW_CLOSE_MINUTES
}
