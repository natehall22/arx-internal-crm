import { addDays, set, startOfDay } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

/** US Eastern — weekly payroll cutoff Wednesday 11:59:59.999 PM local. */
export const WEEKLY_PAYROLL_TZ = 'America/New_York'

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
