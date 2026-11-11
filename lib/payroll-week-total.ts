/**
 * THE definition of "what is a person's total for a pay week" (Known Redundancy #15, folded 2026-11-12).
 *
 * A week's check is the sum of the person's lines from these sources, each amount rounded to the cent first; the check is never
 * below $0 (what is owed back carries to the next open week). Three things run on this one list:
 *   - the screen (`composeWeek`, lib/payroll-pay-week.ts) sums its lines with `personRawTotal`;
 *   - the database validator `payroll_week_person_totals` (latest migration that defines it) is its SQL copy —
 *     lib/__tests__/payroll-week-total-parity.test.ts reads the SQL and fails if a source, amount column or filter differs;
 *   - the in-memory database used by tests (lib/test-helpers/fake-payroll-rpc.ts) runs `personTotalsFromTables` below.
 * Adding a pay-line kind = one entry here + the SQL function in a migration; the parity test tells you if you forgot one.
 */
import { roundMoney } from '@/lib/money'

export type PayLineKind = 'Commission' | 'Hourly' | 'Units' | 'Minimum' | 'Bonus' | 'Adjustment'

type Row = Record<string, unknown>

export type PayLineSource = {
  kind: PayLineKind
  table: string
  amount: string
  /** Which stored rows count toward the check. Mirrors the SQL WHERE clause (see the parity test). */
  counts: (row: Row) => boolean
  /** The SQL predicate beyond org + week, exactly as written in payroll_week_person_totals (whitespace-insensitive). */
  sqlFilter: string | null
}

const num = (v: unknown) => Number(v) || 0

export const PAY_LINE_SOURCES: readonly PayLineSource[] = [
  { kind: 'Commission', table: 'payroll_payout_lines', amount: 'net_amount', counts: () => true, sqlFilter: null },
  { kind: 'Hourly', table: 'payroll_rep_hours', amount: 'hourly_earnings', counts: (r) => num(r.hourly_earnings) > 0, sqlFilter: 'COALESCE(h.hourly_earnings, 0) > 0' },
  { kind: 'Units', table: 'payroll_unit_earnings', amount: 'amount', counts: (r) => num(r.amount) > 0, sqlFilter: 'u.amount > 0' },
  { kind: 'Minimum', table: 'payroll_week_minimums', amount: 'amount', counts: (r) => num(r.amount) > 0, sqlFilter: 'COALESCE(m.amount, 0) > 0' },
  { kind: 'Bonus', table: 'payroll_bonus_lines', amount: 'amount', counts: (r) => r.status === 'approved' || r.status === 'paid', sqlFilter: "b.status IN ('approved', 'paid')" },
  { kind: 'Adjustment', table: 'payroll_adjustments', amount: 'amount', counts: (r) => r.status !== 'void', sqlFilter: "a.status <> 'void'" },
]

/** A person's total before the $0 floor: every line rounded to the cent, then summed (the SQL does the same). */
export function personRawTotal(lines: ReadonlyArray<{ amount: number }>): number {
  return roundMoney(lines.reduce((s, l) => roundMoney(s + roundMoney(Number(l.amount) || 0)), 0))
}

/** What the check pays: never below $0. */
export const payableTotal = (raw: number) => Math.max(0, raw)

/** The validator over stored rows (the in-memory twin of payroll_week_person_totals). */
export function personTotalsFromTables(tables: Record<string, Row[] | undefined>, orgId: string, periodId: string): Map<string, number> {
  const lines = new Map<string, Array<{ amount: number }>>()
  for (const src of PAY_LINE_SOURCES) {
    for (const r of tables[src.table] ?? []) {
      if (r.org_id !== orgId || r.payroll_period_id !== periodId || !src.counts(r)) continue
      const id = r.user_id as string
      lines.set(id, [...(lines.get(id) ?? []), { amount: num(r[src.amount]) }])
    }
  }
  return new Map(Array.from(lines.entries()).map(([id, ls]) => [id, personRawTotal(ls)]))
}
