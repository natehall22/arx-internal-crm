import { addDays, endOfDay, set, startOfDay } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

/** US Eastern — weekly payroll cutoff Wednesday 11:59:59.999 PM local. */
export const WEEKLY_PAYROLL_TZ = 'America/New_York'

export type PayrollScheduleCadence = 'weekly' | 'semi_monthly'

/**
 * Next Wednesday 11:59:59.999 PM Eastern time **strictly after** `referenceUtc`.
 * Used to decide whether eligibility falls before/after the current cycle cutoff.
 */
export function getNextWeeklyPayrollCutoffEtAfter(referenceUtc: Date): Date {
  const refLocal = toZonedTime(referenceUtc, WEEKLY_PAYROLL_TZ)
  const start = startOfDay(refLocal)
  for (let i = 0; i < 21; i++) {
    const day = addDays(start, i)
    if (day.getDay() !== 3) continue
    const cutoffLocal = set(day, {
      hours: 23,
      minutes: 59,
      seconds: 59,
      milliseconds: 999,
    })
    const cutoffUtc = fromZonedTime(cutoffLocal, WEEKLY_PAYROLL_TZ)
    if (cutoffUtc.getTime() > referenceUtc.getTime()) {
      return cutoffUtc
    }
  }
  throw new Error('Unable to compute next weekly payroll cutoff')
}

/**
 * The most recent Wednesday 11:59:59.999 PM Eastern at or before `referenceUtc` — the cutoff of the week that is
 * ready to be paid ("Pay this week" shows the week that just ended).
 */
export function getLastWeeklyPayrollCutoffEtAtOrBefore(referenceUtc: Date): Date {
  const refLocal = toZonedTime(referenceUtc, WEEKLY_PAYROLL_TZ)
  const start = startOfDay(refLocal)
  for (let i = 0; i < 21; i++) {
    const day = addDays(start, -i)
    if (day.getDay() !== 3) continue
    const cutoffUtc = fromZonedTime(set(day, { hours: 23, minutes: 59, seconds: 59, milliseconds: 999 }), WEEKLY_PAYROLL_TZ)
    if (cutoffUtc.getTime() <= referenceUtc.getTime()) return cutoffUtc
  }
  throw new Error('Unable to compute last weekly payroll cutoff')
}

/** The Eastern calendar date (YYYY-MM-DD) of an instant. A Wednesday-night cutoff is already Thursday in UTC, so never slice an ISO string for it. */
export function ymdEt(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: WEEKLY_PAYROLL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** The Eastern calendar date of a period's cutoff: the one date plans, sale dates and hours are looked up by. */
export function cutoffYmdEt(cutoffAt: string | Date): string {
  return ymdEt(typeof cutoffAt === 'string' ? new Date(cutoffAt) : cutoffAt)
}

/** Payday for a weekly cutoff: the Friday after it (Eastern calendar date, YYYY-MM-DD). */
export function weeklyPayrollPayDateForCutoff(cutoffUtc: Date): string {
  const local = toZonedTime(cutoffUtc, WEEKLY_PAYROLL_TZ)
  const friday = addDays(startOfDay(local), 2)
  const y = friday.getFullYear()
  const m = String(friday.getMonth() + 1).padStart(2, '0')
  const d = String(friday.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * `payroll_eligible_at = max(install_completed_at, fully_funded_at, costs_ready_at)` when all three exist.
 */
export function computePayrollEligibleAt(
  install: Date | null,
  funded: Date | null,
  costs: Date | null
): Date | null {
  if (!install || !funded || !costs) return null
  return new Date(Math.max(install.getTime(), funded.getTime(), costs.getTime()))
}

/**
 * Semi-monthly cutoffs: end of day on the 15th and last day of the month (local tz).
 */
export function getSemiMonthlyCutoffs(
  year: number,
  month: number,
  tz: string = WEEKLY_PAYROLL_TZ
): [Date, Date] {
  const m = month - 1
  const midLocal = endOfDay(new Date(year, m, 15))
  const lastLocal = endOfDay(new Date(year, m + 1, 0))
  return [fromZonedTime(midLocal, tz), fromZonedTime(lastLocal, tz)]
}
