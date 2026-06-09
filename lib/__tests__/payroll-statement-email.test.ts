jest.mock('jspdf', () => ({
  jsPDF: jest.fn().mockImplementation(() => ({
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
    setFont: jest.fn(),
    setFontSize: jest.fn(),
    setTextColor: jest.fn(),
    setFillColor: jest.fn(),
    setDrawColor: jest.fn(),
    setLineWidth: jest.fn(),
    setLineDashPattern: jest.fn(),
    text: jest.fn(),
    splitTextToSize: (t: string) => [t],
    line: jest.fn(),
    rect: jest.fn(),
    addImage: jest.fn(),
    addPage: jest.fn(),
    getNumberOfPages: jest.fn(() => 1),
    output: () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 0]).buffer,
  })),
}))

import {
  buildPayrollStatementEmailHtml,
  buildPayrollStatementEmailSubject,
  buildPayrollStatementEmailUrl,
} from '@/lib/payroll-statement-email'
import {
  buildPayrollStatementPdfBuffer,
  formatNegativePayrollMoney,
  payrollStatementPdfFilename,
} from '@/lib/pdf/payroll-statement'
import type { PayrollStatementPayload } from '@/lib/payroll-statement'

const sampleStatement: PayrollStatementPayload = {
  period: {
    id: 'period-123',
    label: '2026-w22',
    cutoffAt: '2026-05-30T16:32:00.000Z',
    payDate: '2026-06-05',
    status: 'locked',
  },
  rep: { id: 'user-1', name: 'Roda Temanil' },
  deals: [],
  hourly: {
    regularHours: 40,
    overtimeHours: 0,
    hourlyRate: 5,
    regularEarnings: 200,
    overtimeEarnings: 0,
    total: 200,
    notes: null,
  },
  periodUnits: {
    components: [{ unitType: 'sale', label: 'Sale pay', count: 3, rate: 10, amount: 30 }],
    lines: [
      {
        unitType: 'sale',
        payTypeLabel: 'Sale pay',
        amount: 10,
        rate: 10,
        customerName: 'Jane Smith',
        eventDate: '2026-05-28',
        opportunityId: 'opp-1',
        leadId: null,
        contractId: 'contract-1',
      },
    ],
    total: 30,
    sitCount: 0,
    saleCount: 3,
  },
  totals: {
    grossCommission: 0,
    hourlyEarnings: 200,
    periodUnitEarnings: 30,
    bonusEarnings: 0,
    chargebacksApplied: 0,
    netPayout: 230,
    hasDeficit: false,
  },
  chargebacks: [],
  bonuses: [],
}

const sampleStatementWithBonuses: PayrollStatementPayload = {
  ...sampleStatement,
  totals: {
    ...sampleStatement.totals,
    bonusEarnings: 800,
    netPayout: 1030,
  },
  bonuses: [
    {
      id: 'bonus-444-week1',
      bonusType: '444_week1',
      description: 'ARX 444 Week 1 qualified',
      amount: 400,
    },
    {
      id: 'bonus-444-week2',
      bonusType: '444_week2',
      description: 'ARX 444 Week 2 qualified',
      amount: 400,
    },
  ],
}

describe('payroll-statement-email', () => {
  it('builds statement URL from app base', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/'
    expect(buildPayrollStatementEmailUrl('period-123')).toBe(
      'https://example.com/commissions/statement/period-123'
    )
  })

  it('builds subject with period and net payout', () => {
    expect(buildPayrollStatementEmailSubject(sampleStatement)).toBe('Pay statement — 2026-w22 — $230.00')
  })

  it('includes bonus summary when bonuses are present', () => {
    const html = buildPayrollStatementEmailHtml({
      recipientName: sampleStatementWithBonuses.rep.name,
      statement: sampleStatementWithBonuses,
      statementUrl: 'https://example.com/commissions/statement/period-123',
      pdfAttached: false,
    })

    expect(html).toContain('Bonuses')
    expect(html).toContain('$800.00')
  })
})

describe('payroll-statement PDF', () => {
  it('formats negative amounts with ASCII minus', () => {
    expect(formatNegativePayrollMoney(25)).toBe('-$25.00')
  })

  it('generates a non-empty PDF buffer', () => {
    const buf = buildPayrollStatementPdfBuffer(sampleStatement)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('sanitizes PDF filename', () => {
    expect(payrollStatementPdfFilename('2026 w22', 'abcd1234-5678')).toBe('pay-statement-2026-w22-abcd1234.pdf')
  })
})
