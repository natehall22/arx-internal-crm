import { toZonedTime } from 'date-fns-tz'
import { EASTERN_TZ } from '@/lib/eastern-datetime'

/** True when local Eastern time is Mon–Sat around 5:30am (matches Vercel cron at :30 9,10 UTC). */
export function isMorningUpdateSendWindow(now: Date = new Date()): boolean {
  const nowLocal = toZonedTime(now, EASTERN_TZ)
  const day = nowLocal.getDay()
  if (day === 0) return false
  const hour = nowLocal.getHours()
  const minute = nowLocal.getMinutes()
  return hour === 5 && minute >= 28 && minute <= 40
}
