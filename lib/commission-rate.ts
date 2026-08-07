/**
 * Shared normalizer for org-level commission rate columns (percent of a job's
 * commission base).
 *
 * Every derived commission line in payroll — inspection, manager override,
 * self-generated — is gated by one of these rates, and every one of them uses the
 * same rule: anything that is not a finite positive number means the line is OFF.
 * A rate of 0 is the deliberate "feature disabled" value, so an unreadable or
 * missing column can never accidentally start paying.
 */
export function normalizeCommissionRatePercent(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}
