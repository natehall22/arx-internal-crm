import { fromZonedTime } from 'date-fns-tz'

/** IANA zone used for lead/calendar labels like "Inspection scheduled for (ET)" */
export const EASTERN_TZ = 'America/New_York'

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
