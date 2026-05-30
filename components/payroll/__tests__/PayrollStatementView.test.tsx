/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import PayrollStatementView from '@/components/payroll/PayrollStatementView'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'

const baseStatement: PayrollStatementPayload = {
  mode: 'estimated',
  statementCalculatedAt: new Date().toISOString(),
  periodStatus: 'open',
  dataFreshnessNote: 'Estimate',
  projectedBreakdown: [{ key: 'c', label: 'Commission', amount: 100 }],
  period: {
    id: 'p1',
    label: 'Week 1',
    cutoffAt: '2026-01-07',
    payDate: '2026-01-10',
    status: 'open',
  },
  rep: { id: 'u1', name: 'Test Rep' },
  deals: [
    {
      jobId: 'j1',
      jobNumber: '100',
      customerName: 'Acme',
      holdStatus: null,
      ntpDate: null,
      installDate: null,
      commissionableAmount: 5000,
      role: 'setter',
      grossAmount: 50,
      ntpCommission: 0,
      revenueCommission: 50,
      premierPricingCommission: 0,
      overrideAmount: 0,
      dealTotal: 50,
      planName: 'Setter plan',
      lineComponents: [{ key: 'p', label: 'Setter plan', amount: 50 }],
      calculationNotes: ['Comp plan: Setter plan'],
    },
    {
      jobId: 'j1',
      jobNumber: '100',
      customerName: 'Acme',
      holdStatus: null,
      ntpDate: null,
      installDate: null,
      commissionableAmount: 5000,
      role: 'owner',
      grossAmount: 120,
      ntpCommission: 0,
      revenueCommission: 120,
      premierPricingCommission: 0,
      overrideAmount: 0,
      dealTotal: 120,
      planName: 'Closer plan',
      lineComponents: [{ key: 'p2', label: 'Closer plan', amount: 120 }],
      calculationNotes: [],
    },
  ],
  hourly: {
    regularHours: 40,
    overtimeHours: 0,
    hourlyRate: 25,
    regularEarnings: 1000,
    overtimeEarnings: 0,
    total: 1000,
    notes: null,
  },
  totals: {
    grossCommission: 170,
    hourlyEarnings: 1000,
    chargebacksApplied: 0,
    netPayout: 1170,
    hasDeficit: false,
    grossCommissionDefinition: 'pre_chargeback',
  },
  chargebacks: [],
}

describe('PayrollStatementView', () => {
  it('renders rep read-only without admin override inputs', () => {
    const { container } = render(<PayrollStatementView statement={baseStatement} />)
    expect(screen.getByText('Estimated statement')).toBeTruthy()
    expect(screen.getByText('Setter')).toBeTruthy()
    expect(screen.getByText('Closer')).toBeTruthy()
    expect(screen.getByText('Hourly earnings')).toBeTruthy()
    expect(container.textContent).not.toContain('Save')
  })

  it('shows expandable how-calculated hint', () => {
    render(<PayrollStatementView statement={baseStatement} />)
    expect(screen.getByText(/Tap a row to see how each amount was calculated/)).toBeTruthy()
  })
})
