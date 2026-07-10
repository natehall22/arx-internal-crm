import { fromZonedTime } from 'date-fns-tz'

/** IANA zone used for lead/calendar labels like "Inspection scheduled for (ET)" */
export const EASTERN_TZ = 'America/New_York'

/** Calendar date YYYY-MM-DD in Eastern Time (matches rep /sisu goal lookups). */
export function getEasternTodayIso(timeZone = EASTERN_TZ): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}

/** 0=Sun … 6=Sat in Eastern Time. */
export function getEasternWeekdayIndex(timeZone = EASTERN_TZ): number {
  const weekday = new Date().toLocaleDateString('en-US', { timeZone, weekday: 'short' })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
}

/** 0=Sun … 6=Sat for a YYYY-MM-DD calendar date interpreted in Eastern Time. */
export function getEasternWeekdayForDateIso(iso: string, timeZone = EASTERN_TZ): number {
  const weekday = fromZonedTime(`${iso}T12:00:00`, timeZone).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
  })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
}

/** Work-week pace factor (Mon=0.2 … Fri=1.0, Sun=0, Sat=1.0) — matches accountability API. */
export function getEasternPaceFactor(timeZone = EASTERN_TZ): number {
  const dayOfWeek = getEasternWeekdayIndex(timeZone)
  return dayOfWeek === 0 ? 0 : Math.min(5, dayOfWeek) / 5
}

/**
 * Converts `<input type="datetime-local" />` values that represent Eastern wall time
 * into a UTC ISO-8601 string for Postgres.
 *
 * Do not use `new Date(isoWithoutOffset)` in server actions: on Vercel/Node the default
 * zone is UTC, so "2026-04-01T12:00" is wrongly read as 12:00 UTC instead of noon Eastern.
 */
export function easternDatetimeLocalToUtcIso(input: string | null | undefined): string | null {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return null

  // Already has zone info (UTC Z or numeric offset)
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed).toISOString()
  }

  const localDateTimeStr = trimmed.length >= 16 ? trimmed.slice(0, 16) : trimmed
  const [datePart, timePart] = localDateTimeStr.split('T')
  if (!datePart || !timePart) {
    return new Date(trimmed).toISOString()
  }

  const [y, m, d] = datePart.split('-').map(Number)
  const [h, min] = timePart.split(':').map(Number)
  if (
    [y, m, d, h, min].some((n) => !Number.isFinite(n))
  ) {
    return new Date(trimmed).toISOString()
  }

  const wall = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
  return fromZonedTime(wall, EASTERN_TZ).toISOString()
}
