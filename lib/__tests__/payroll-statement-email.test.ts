import {
  computeStatementHash,
  payrollStatementEmailSubject,
  renderPayrollStatementEmailHtml,
  resolvePayrollStatementUrl,
} from '@/lib/payroll-statement-email'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'

const sampleStatement: PayrollStatementPayload = {
  mode: 'final',
  statementCalculatedAt: '2026-01-10T12:00:00Z',
  periodStatus: 'locked',
  dataFreshnessNote: 'Official statement from locked payout lines.',
  projectedBreakdown: [],
  period: {
    id: 'period-1',
    label: 'Week of Jan 5',
    cutoffAt: '2026-01-07',
    payDate: '2026-01-10',
    status: 'locked',
  },
  rep: { id: 'u1', name: 'Jane Rep' },
  deals: [
    {
      jobId: 'j1',
      jobNumber: '100',
      customerName: 'Acme',
      holdStatus: null,
      ntpDate: null,
      installDate: null,
      commissionableAmount: 5000,
      role: 'closer',
      grossAmount: 200,
      ntpCommission: 0,
      revenueCommission: 200,
      premierPricingCommission: 0,
      overrideAmount: 0,
      dealTotal: 200,
      planName: 'Closer',
      lineComponents: [],
      calculationNotes: [],
    },
  ],
  hourly: null,
  totals: {
    grossCommission: 200,
    hourlyEarnings: 0,
    chargebacksApplied: 0,
    netPayout: 200,
    hasDeficit: false,
    grossCommissionDefinition: 'pre_chargeback',
  },
  chargebacks: [],
}

describe('payrollStatementEmailSubject', () => {
  it('uses plain title for final mode', () => {
    const subject = payrollStatementEmailSubject(sampleStatement)
    expect(subject).toContain('Pay statement')
    expect(subject).not.toContain('(estimate)')
    expect(subject).toContain('Week of Jan 5')
  })

  it('labels estimate mode in subject', () => {
    const subject = payrollStatementEmailSubject({
      ...sampleStatement,
      mode: 'estimated',
    })
    expect(subject).toContain('(estimate)')
  })

  it('does not label final locked statements as estimate', () => {
    const subject = payrollStatementEmailSubject(sampleStatement)
    expect(subject).not.toContain('(estimate)')
  })
})

describe('computeStatementHash', () => {
  it('is stable for the same payload', () => {
    expect(computeStatementHash(sampleStatement)).toBe(computeStatementHash(sampleStatement))
  })

  it('changes when net payout changes', () => {
    const other = {
      ...sampleStatement,
      totals: { ...sampleStatement.totals, netPayout: 201 },
    }
    expect(computeStatementHash(other)).not.toBe(computeStatementHash(sampleStatement))
  })
})

describe('renderPayrollStatementEmailHtml', () => {
  it('includes official banner and net payout for final mode', () => {
    const html = renderPayrollStatementEmailHtml({
      statement: sampleStatement,
      statementUrl: 'https://app.example.com/commissions/statement/period-1',
    })
    expect(html).toContain('Official pay statement')
    expect(html).toContain('Jane Rep')
    expect(html).toContain('Week of Jan 5')
    expect(html).toContain('$200.00')
    expect(html).toContain('View full statement')
    expect(html).toContain('not the dashboard')
    expect(html).toContain('estimated pay this week')
  })

  it('labels estimate mode and warns not final', () => {
    const est = { ...sampleStatement, mode: 'estimated' as const }
    const html = renderPayrollStatementEmailHtml({
      statement: est,
      statementUrl: resolvePayrollStatementUrl('https://app.example.com', 'period-1'),
    })
    expect(html).toContain('Estimated pay statement')
    expect(html).toContain('not locked yet')
    expect(html).toContain('Dashboard weekly estimates use a separate system')
  })
})

describe('resolvePayrollStatementUrl', () => {
  it('uses path-based period id', () => {
    expect(resolvePayrollStatementUrl('https://app.example.com/', 'abc-123')).toBe(
      'https://app.example.com/commissions/statement/abc-123'
    )
  })
})
