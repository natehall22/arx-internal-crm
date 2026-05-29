/**
 * Rounds a number to the nearest cent using the standard payroll rounding rule.
 * Single source of truth — all payroll/commission math must import from here.
 */
export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}
