import { toZonedTime } from 'date-fns-tz'
import { EASTERN_TZ } from '@/lib/eastern-datetime'

/** First fire of the morning: 5:28am ET, a couple of minutes of slack before 5:30. */
const WINDOW_OPEN_MINUTES = 5 * 60 + 28
/** Last minute a retry may still deliver. Past this the update is stale enough to skip the day. */
const WINDOW_CLOSE_MINUTES = 8 * 60 + 59

/**
 * True when local Eastern time is Mon–Sat between 5:28am and 8:59am — the window the Vercel
 * cron fires across (:30 past 9,10,11,12 UTC, which covers 5:30am ET in both EST and EDT).
 *
 * The window is wide on purpose: the first fire is the intended 5:30am send and the rest are
 * retries for when it fails (a Supabase 503 ate the 2026-08-14 send outright). Only one email
 * per day actually goes out — `claimDailyBlast` in lib/email-blast-ledger is what enforces that.
 */
export function isMorningUpdateSendWindow(now: Date = new Date()): boolean {
  const nowLocal = toZonedTime(now, EASTERN_TZ)
  if (nowLocal.getDay() === 0) return false
  const minutes = nowLocal.getHours() * 60 + nowLocal.getMinutes()
  return minutes >= WINDOW_OPEN_MINUTES && minutes <= WINDOW_CLOSE_MINUTES
}
