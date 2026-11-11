import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { loadInvoiceTaxCentsByJob } from '@/lib/job-invoice-tax'
import { buildJobPaymentSummary } from '@/lib/job-payments'
import { paymentStatusChip } from '@/lib/job-status'
import { derivePayrollEligibility, waitingReasonText } from '@/lib/payroll-period-materialization'
import { derivePayrollEligibility as deriveLegacy } from '@/lib/legacy-payroll-materialization'
import type { JobPayment } from '@/lib/types/job-payments'

const pay = (cents: number) => ({ amount_cents: cents, funding_status: 'cleared', paid_at: '2026-11-01', created_at: '2026-11-01T12:00:00Z', job_id: 'j1' })

describe('invoice tax is owed on top of sale_amount — every paid-in-full reader', () => {
  it('loader: sums non-void invoice tax per job; void and untaxed invoices ignored', async () => {
    const { client } = createFakeDb({
      job_invoices: [
        { id: 'a', job_id: 'j1', status: 'sent', tax_cents: 4500 },
        { id: 'b', job_id: 'j1', status: 'paid', tax_cents: 300 },
        { id: 'c', job_id: 'j1', status: 'void', tax_cents: 9999 },
        { id: 'd', job_id: 'j2', status: 'sent', tax_cents: 0 },
      ],
    })
    const m = await loadInvoiceTaxCentsByJob(client, ['j1', 'j2'])
    expect(m.get('j1')).toBe(4800)
    expect(m.get('j2') ?? 0).toBe(0)
  })

  it('loader: before migration 202611110040 (no tax_cents) everything is 0', async () => {
    const err = { code: '42703', message: 'column job_invoices.tax_cents does not exist' }
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.in = () => Promise.resolve({ data: null, error: err })
    const client = { from: () => q } as never
    expect((await loadInvoiceTaxCentsByJob(client, ['j1'])).size).toBe(0)
  })

  it('job page summary: contract paid, tax unpaid = not paid, owes the tax; contract + tax = paid, not overpaid', () => {
    const job = { sale_amount: 1000, invoice_tax_cents: 7500 }
    const short = buildJobPaymentSummary(job, [pay(100000)] as unknown as JobPayment[])
    expect(short).toMatchObject({ paid_in_full: false, remaining_cents: 7500, sale_amount_cents: 107500, invoice_tax_cents: 7500 })
    const full = buildJobPaymentSummary(job, [pay(107500)] as unknown as JobPayment[])
    expect(full).toMatchObject({ paid_in_full: true, remaining_cents: 0 })
  })

  it('ARX (no invoice tax): summary unchanged', () => {
    const s = buildJobPaymentSummary({ sale_amount: 16325 }, [pay(1632500)] as unknown as JobPayment[])
    expect(s).toMatchObject({ paid_in_full: true, remaining_cents: 0, sale_amount_cents: 1632500, invoice_tax_cents: 0 })
  })

  it('board chip (ops board + catch-up)', () => {
    expect(paymentStatusChip({ sale_amount: 1000, collected_cents: 100000, invoice_tax_cents: 7500 })?.label).not.toBe('Paid in full')
    expect(paymentStatusChip({ sale_amount: 1000, collected_cents: 107500, invoice_tax_cents: 7500 })?.label).toBe('Paid in full')
    expect(paymentStatusChip({ sale_amount: 1000, collected_cents: 100000 })?.label).toBe('Paid in full')
  })

  it('payroll eligibility (new and legacy paths): tax unpaid blocks, tax paid releases', () => {
    const base = { id: 'j1', status: 'complete', sale_amount: 1000, completed_at: '2026-11-01T12:00:00Z', allow_close_with_balance: false, close_balance_by: null }
    for (const derive of [derivePayrollEligibility, deriveLegacy]) {
      const blocked = derive({ job: { ...base, invoice_tax_cents: 7500 } as never, payments: [pay(100000)] as never, costs: [] })
      expect(blocked.reason).toBe('not_funded')
      const ok = derive({ job: { ...base, invoice_tax_cents: 7500 } as never, payments: [pay(107500)] as never, costs: [] })
      expect(ok.reason).toBeNull()
      const arx = derive({ job: base as never, payments: [pay(100000)] as never, costs: [] })
      expect(arx.reason).toBeNull()
    }
  })

  it('payroll waiting text includes the tax owed', () => {
    expect(waitingReasonText('not_funded', 100000, 1000, 7500)).toBe('Customer still owes $75 of $1,075')
    expect(waitingReasonText('not_funded', 50000, 1000)).toBe('Customer still owes $500 of $1,000')
  })
})

describe('guard: no paid-in-full caller forgets invoice tax', () => {
  it('every evaluateJobCollection call passes invoiceTaxCents', () => {
    const { execSync } = require('child_process') as typeof import('child_process')
    const files = execSync("grep -rl 'evaluateJobCollection(' app lib components --include=*.ts --include=*.tsx", { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f && !f.includes('__tests__') && f !== 'lib/job-collection.ts')
    expect(files.length).toBeGreaterThan(5)
    const fs = require('fs') as typeof import('fs')
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      const calls = src.split('evaluateJobCollection(').length - 1
      const withTax = (src.match(/evaluateJobCollection\(\{[^}]*invoiceTaxCents/g) || []).length
      expect({ file: f, missing: calls - withTax }).toEqual({ file: f, missing: 0 })
    }
  })
})
