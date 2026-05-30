/**
 * Ship-gate fixture: gross commission from export rows (via resolveParticipantLineAmount)
 * must match computePayrollStatementTotals for the same deal lines — same path as lock preview.
 */
import type { PayrollExportRow } from '@/lib/payroll-export'
import {
  computePayrollStatementTotals,
  resolveParticipantLineAmount,
} from '@/lib/payroll-statement'

function exportRow(overrides: Partial<PayrollExportRow>): PayrollExportRow {
  return {
    job_id: 'j1',
    job_number: '1001',
    customer_name: 'Customer',
    sale_date: '2026-01-05',
    address_text: '1 Main St',
    sale_amount: 10000,
    commission_comp_base: 10000,
    pool_cap: null,
    user_id: 'rep-closer',
    user_name: 'Closer Rep',
    participant_role: 'sales_rep',
    comp_plan_id: 'cp1',
    comp_plan_name: 'Closer plan',
    plan_type: 'standard',
    base_rate_pct: 12,
    period_volume: 10000,
    volume_bonus_rate_pct: 0,
    volume_bonus_flat: 0,
    effective_rate_pct: 12,
    raw_commission: 1200,
    scaled_commission: 1200,
    pool_cap_enforced: false,
    unsupported_plan: false,
    note: null,
    ...overrides,
  }
}

function sumExportGrossForRep(
  rows: PayrollExportRow[],
  userId: string,
  overridesByJobRole: Map<string, Record<string, unknown>> = new Map()
): number {
  return rows
    .filter((r) => r.user_id === userId)
    .reduce((sum, row) => {
      const roleKey = `${row.job_id}|${row.participant_role}`
      const explicit = overridesByJobRole.get(roleKey)
      const resolved = resolveParticipantLineAmount(
        row.scaled_commission,
        row.commission_comp_base ?? 0,
        explicit
      )
      return sum + resolved.grossAmount
    }, 0)
}

describe('export vs statement totals reconcile (fixture period)', () => {
  const fixtureRows: PayrollExportRow[] = [
    exportRow({ job_id: 'j1', user_id: 'rep-closer', scaled_commission: 1200 }),
    exportRow({
      job_id: 'j1',
      user_id: 'rep-setter',
      participant_role: 'setter',
      scaled_commission: 400,
      comp_plan_name: 'Setter plan',
    }),
    exportRow({
      job_id: 'j2',
      user_id: 'rep-closer',
      scaled_commission: 800,
      commission_comp_base: 8000,
    }),
  ]

  it('closer gross from export rows matches statement totals (no chargebacks, no hourly)', () => {
    const overrides = new Map<string, Record<string, unknown>>([
      ['j1|sales_rep', { override_percent: 10 }],
    ])
    const exportGross = sumExportGrossForRep(fixtureRows, 'rep-closer', overrides)
    const dealLines = [
      { grossAmount: 1000, dealTotal: 1000 },
      { grossAmount: 800, dealTotal: 800 },
    ]
    const totals = computePayrollStatementTotals({
      deals: dealLines,
      hourlyTotal: 0,
      chargebacksApplied: 0,
    })
    expect(exportGross).toBe(1800)
    expect(totals.grossCommission).toBe(1800)
    expect(totals.netPayout).toBe(1800)
  })

  it('setter export gross is independent per rep (same job, two participants)', () => {
    expect(sumExportGrossForRep(fixtureRows, 'rep-setter')).toBe(400)
    expect(sumExportGrossForRep(fixtureRows, 'rep-closer')).toBe(2000)
  })

  it('hourly adds to net without changing export gross reconcile target', () => {
    const exportGross = sumExportGrossForRep(fixtureRows, 'rep-closer')
    const hourly = 450
    const totals = computePayrollStatementTotals({
      deals: [
        { grossAmount: 1200, dealTotal: 1200 },
        { grossAmount: 800, dealTotal: 800 },
      ],
      hourlyTotal: hourly,
      chargebacksApplied: 0,
    })
    expect(exportGross).toBe(2000)
    expect(totals.grossCommission).toBe(2000)
    expect(totals.netPayout).toBe(2450)
  })
})
