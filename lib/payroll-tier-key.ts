/**
 * Produces the composite key used in volume, sits, and sales Maps throughout payroll
 * calculation. Centralising the format here ensures Maps built in one function can be
 * safely consumed in another without hidden string-format assumptions.
 *
 * Format: "<userId>|<YYYY-MM>"
 */
export function payrollTierKey(userId: string, monthKey: string): string {
  return `${userId}|${monthKey}`
}
