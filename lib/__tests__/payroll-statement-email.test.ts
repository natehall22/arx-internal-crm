jest.mock('jspdf', () => ({
  jsPDF: jest.fn().mockImplementation(() => ({
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
    setFont: jest.fn(),
    setFontSize: jest.fn(),
    setTextColor: jest.fn(),
    text: jest.fn(),
    splitTextToSize: (t: string) => [t],
    addPage: jest.fn(),
    output: () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 0]).buffer,
  })),
}))

import {
  buildPayrollStatementEmailSubject,
  buildPayrollStatementEmailUrl,
} from '@/lib/payroll-statement-email'
import { buildPayrollStatementPdfBuffer, payrollStatementPdfFilename } from '@/lib/pdf/payroll-statement'
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
    chargebacksApplied: 0,
    netPayout: 230,
    hasDeficit: false,
  },
  chargebacks: [],
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
})

describe('payroll-statement PDF', () => {
  it('generates a non-empty PDF buffer', () => {
    const buf = buildPayrollStatementPdfBuffer(sampleStatement)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('sanitizes PDF filename', () => {
    expect(payrollStatementPdfFilename('2026 w22', 'abcd1234-5678')).toBe('pay-statement-2026-w22-abcd1234.pdf')
  })
})
