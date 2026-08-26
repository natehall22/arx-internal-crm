/**
 * Mapping a work week onto the payroll period that should pay it.
 *
 * Extracted from lib/sync-444-core.ts when the Sisu 444 program was retired
 * (2026-08-25). These two helpers were never 444-specific — the setter-ramp
 * program (lib/sync-setter-ramp-core.ts, live) has always imported them and is
 * now the only consumer, so they live in a neutral module rather than inside a
 * deleted program's engine.
 */

type PayrollPeriodRow = {
  id: string
  scheduled_pay_date: string
}

/** Org payroll timezone. See the ORG_TIMEZONE consolidation item in CLAUDE.md. */
export const PAYROLL_TZ = 'America/New_York'

/**
 * Calendar date (YYYY-MM-DD) of an instant in the payroll timezone. Used to
 * compare a work-week boundary against payroll_periods.scheduled_pay_date
 * (a DATE).
 */
export function payrollZoneDate(iso: string, timezone = PAYROLL_TZ): string {
  // en-CA formats as YYYY-MM-DD, which sorts/compares correctly as a string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/**
 * Pick the payroll period a work week's bonus should pay in: the EARLIEST
 * attachable period whose scheduled pay date falls on/after the week's
 * (exclusive) end — i.e. the payday following the work week. Returns null when
 * no such period exists yet, in which case the caller HOLDS the bonus (no line)
 * and a later sync attaches it once the right period is created. `openPeriods`
 * must contain only attachable periods; order does not matter.
 */
export function pickPayrollPeriodForWeekEnd(
  openPeriods: PayrollPeriodRow[],
  weekEndsAtIso: string,
  timezone = PAYROLL_TZ,
): string | null {
  const weekEndDate = payrollZoneDate(weekEndsAtIso, timezone)
  let best: PayrollPeriodRow | null = null
  for (const p of openPeriods) {
    if (!p.scheduled_pay_date) continue
    if (p.scheduled_pay_date < weekEndDate) continue // pays before the week closes — too early
    if (best === null || p.scheduled_pay_date < best.scheduled_pay_date) best = p
  }
  return best?.id ?? null
}
