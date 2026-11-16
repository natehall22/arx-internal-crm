/**
 * Date-only (`YYYY-MM-DD`) arithmetic with no server imports, so client code (the ops board's catch-up, data health) can use it
 * without pulling lib/install-calendar.ts — and the server-only mail / calendar / payment doors behind it — into the browser
 * bundle. Moved here VERBATIM from lib/install-calendar.ts (which still re-exports `addDaysToDateOnly`); no behavior change.
 */
import { addDays, format } from 'date-fns'

/**
 * Build a local (non-UTC) Date from a bare `YYYY-MM-DD` string's own y/m/d
 * parts. This is NOT `new Date(dateStr)` — that parses as UTC midnight and is
 * exactly the round-trip this file must avoid.
 */
function dateOnlyFromParts(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) throw new Error(`Invalid YYYY-MM-DD date: ${dateStr}`)
  const [, y, m, d] = match
  return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0)
}

/**
 * Add `days` calendar days to a bare `YYYY-MM-DD` string, returning a bare
 * `YYYY-MM-DD` string. Pure date-only arithmetic — see file header.
 */
export function addDaysToDateOnly(dateStr: string, days: number): string {
  const shifted = addDays(dateOnlyFromParts(dateStr), days)
  return format(shifted, 'yyyy-MM-dd')
}
