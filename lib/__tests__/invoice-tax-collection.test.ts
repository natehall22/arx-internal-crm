import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { collectionInvoiceFields, loadJobInvoiceFacts } from '@/lib/job-invoice-tax'
import { buildJobPaymentSummary } from '@/lib/job-payments'
import { evaluateJobCollection } from '@/lib/job-collection'
import { paymentStatusChip } from '@/lib/job-status'
import { derivePayrollEligibility, waitingReasonText } from '@/lib/payroll-period-materialization'
import { derivePayrollEligibility as deriveLegacy } from '@/lib/legacy-payroll-materialization'
import type { JobPayment } from '@/lib/types/job-payments'

const pay = (cents: number) => ({ amount_cents: cents, funding_status: 'cleared', paid_at: '2026-11-01', created_at: '2026-11-01T12:00:00Z', job_id: 'j1' })

describe('invoice tax is owed on top of sale_amount — every paid-in-full reader', () => {
  it('loader: sums non-void invoice tax per job; void and untaxed invoices ignored', async () => {
    const { client } = createFakeDb({
      job_invoices: [
        { id: 'a', job_id: 'j1', status: 'sent', tax_cents: 4500, total_cents: 104500 },
        { id: 'b', job_id: 'j1', status: 'paid', tax_cents: 300, total_cents: 5300 },
        { id: 'c', job_id: 'j1', status: 'void', tax_cents: 9999, total_cents: 99999 },
        { id: 'd', job_id: 'j2', status: 'sent', tax_cents: 0, total_cents: 100 },
      ],
      production_jobs: [{ id: 'j1', billing_mode: null }, { id: 'j2', billing_mode: 'time_materials' }],
    })
    const m = await loadJobInvoiceFacts(client, ['j1', 'j2'])
    expect(m.get('j1')).toEqual({ taxCents: 4800, invoicedTotalCents: 109800, invoicedPreTaxCents: 105000, timeAndMaterials: false, issuedTotalCents: 109800, issuedPreTaxCents: 105000, pending: false })
    expect(m.get('j2')?.taxCents ?? 0).toBe(0)
    expect(collectionInvoiceFields(m.get('j1'))).toEqual({ invoiceTaxCents: 4800, timeAndMaterialsInvoicedCents: null, timeAndMaterialsPending: false })
    expect(collectionInvoiceFields(m.get('j2'))).toEqual({ invoiceTaxCents: 0, timeAndMaterialsInvoicedCents: 100, timeAndMaterialsPending: false })
  })

  it('loader: before migration 202611110040 (no tax_cents) everything is 0', async () => {
    const err = { code: '42703', message: 'column job_invoices.tax_cents does not exist' }
    // job_invoices: tax_cents missing → retried without; production_jobs: billing_mode missing (202611120030 not applied).
    const calls: string[] = []
    const client = {
      from: (t: string) => {
        const q: Record<string, unknown> = {}
        let cols = ''
        q.select = (c: string) => ((cols = c), q)
        q.in = () => {
          calls.push(`${t}:${cols}`)
          if (t === 'job_invoices' && cols.includes('tax_cents')) return Promise.resolve({ data: null, error: err })
          if (t === 'production_jobs') return Promise.resolve({ data: null, error: { code: '42703', message: 'column production_jobs.billing_mode does not exist' } })
          return Promise.resolve({ data: [{ job_id: 'j1', status: 'sent', total_cents: 500 }], error: null })
        }
        return q
      },
    } as never
    const m = await loadJobInvoiceFacts(client, ['j1'])
    expect(m.get('j1')).toEqual({ taxCents: 0, invoicedTotalCents: 500, invoicedPreTaxCents: 500, timeAndMaterials: false, issuedTotalCents: 500, issuedPreTaxCents: 500, pending: false })
    expect(collectionInvoiceFields(m.get('j1'))).toEqual({ invoiceTaxCents: 0, timeAndMaterialsInvoicedCents: null, timeAndMaterialsPending: false })
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

describe('time & materials: owed = what was invoiced (tax included), not the estimate', () => {
  it('loader: drafts are not owed and keep the job "still being billed"; so do clocked days not yet approved', async () => {
    const at = (iso: string) => iso
    const db = createFakeDb({
      orgs: [{ id: 'o1', timezone: 'UTC' }],
      production_jobs: [{ id: 'j1', billing_mode: 'time_materials' }, { id: 'j2', billing_mode: 'time_materials' }, { id: 'j3', billing_mode: 'time_materials' }],
      job_invoices: [
        { id: 'a', job_id: 'j1', status: 'sent', tax_cents: 700, total_cents: 10700 },
        { id: 'b', job_id: 'j1', status: 'draft', tax_cents: 0, total_cents: 5000 },
        { id: 'c', job_id: 'j2', status: 'paid', tax_cents: 0, total_cents: 20000 },
        { id: 'd', job_id: 'j3', status: 'paid', tax_cents: 0, total_cents: 20000 },
      ],
      time_entries: [
        { id: 't1', org_id: 'o1', production_job_id: 'j2', kind: 'work', started_at: at('2026-11-03T13:00:00Z'), removed_at: null },
        { id: 't2', org_id: 'o1', production_job_id: 'j3', kind: 'work', started_at: at('2026-11-03T13:00:00Z'), removed_at: null },
        { id: 't3', org_id: 'o1', production_job_id: 'j3', kind: 'work', started_at: at('2026-11-04T13:00:00Z'), removed_at: at('2026-11-05T00:00:00Z') },
      ],
      billed_time_days: [{ id: 'b1', production_job_id: 'j3', work_date: '2026-11-03', status: 'approved' }],
    })
    const m = await loadJobInvoiceFacts(db.client, ['j1', 'j2', 'j3'])
    expect(collectionInvoiceFields(m.get('j1'))).toEqual({ invoiceTaxCents: 700, timeAndMaterialsInvoicedCents: 10700, timeAndMaterialsPending: true })
    expect(m.get('j1')?.issuedPreTaxCents).toBe(10000)
    expect(collectionInvoiceFields(m.get('j2'))).toEqual({ invoiceTaxCents: 0, timeAndMaterialsInvoicedCents: 20000, timeAndMaterialsPending: true })
    expect(collectionInvoiceFields(m.get('j3'))).toEqual({ invoiceTaxCents: 0, timeAndMaterialsInvoicedCents: 20000, timeAndMaterialsPending: false })
    // Paid in full waits while still being billed — payroll eligibility (both paths) too.
    expect(evaluateJobCollection({ saleAmount: 1, ...collectionInvoiceFields(m.get('j2')), collectedCents: 20000 })).toMatchObject({ paidInFull: false, waitingOnBilling: true })
    expect(evaluateJobCollection({ saleAmount: 1, ...collectionInvoiceFields(m.get('j3')), collectedCents: 20000 })).toMatchObject({ paidInFull: true })
    const base = { id: 'j2', status: 'complete', sale_amount: 1, completed_at: '2026-11-05T12:00:00Z', allow_close_with_balance: false, close_balance_by: null, tm_invoiced_cents: 20000, tm_pending: true }
    for (const derive of [derivePayrollEligibility, deriveLegacy]) expect(derive({ job: base as never, payments: [pay(20000)] as never, costs: [] }).reason).toBe('not_funded')
    expect(waitingReasonText('not_funded', 20000, 1, 0, 20000, true)).toMatch(/still being billed/)
  })

  it('the rule', () => {
    const tm = (paid: number, invoiced: number | null) => evaluateJobCollection({ saleAmount: 5000, invoiceTaxCents: 700, timeAndMaterialsInvoicedCents: invoiced, collectedCents: paid })
    expect(tm(10700, 10700)).toMatchObject({ requiredCents: 10700, paidInFull: true, timeAndMaterials: true })
    expect(tm(10000, 10700)).toMatchObject({ paidInFull: false, remainingCents: 700 })
    // the estimate paid but more hours billed: not paid
    expect(tm(500000, 600000)).toMatchObject({ paidInFull: false, remainingCents: 100000 })
    // nothing invoiced yet: nothing to collect against, never "paid"
    expect(tm(0, 0)).toMatchObject({ paidInFull: false, missingSaleAmount: true })
    // fixed price (null): exactly as before
    expect(tm(500700, null)).toMatchObject({ requiredCents: 500700, paidInFull: true, timeAndMaterials: false })
  })
  it('summary, chip, payroll (both paths) and waiting text follow it', () => {
    const job = { sale_amount: 5000, invoice_tax_cents: 700, tm_invoiced_cents: 10700 }
    expect(buildJobPaymentSummary(job, [pay(10700)] as unknown as JobPayment[])).toMatchObject({ paid_in_full: true, sale_amount_cents: 10700, tm_invoiced_cents: 10700 })
    expect(buildJobPaymentSummary(job, [pay(5000)] as unknown as JobPayment[])).toMatchObject({ paid_in_full: false, remaining_cents: 5700 })
    expect(paymentStatusChip({ sale_amount: 5000, collected_cents: 10000, tm_invoiced_cents: 10700 })?.label).toBe('Partially paid')
    expect(paymentStatusChip({ sale_amount: 5000, collected_cents: 0, tm_invoiced_cents: 0 })).toBeNull()
    const base = { id: 'j1', status: 'complete', sale_amount: 5000, completed_at: '2026-11-01T12:00:00Z', allow_close_with_balance: false, close_balance_by: null }
    for (const derive of [derivePayrollEligibility, deriveLegacy]) {
      expect(derive({ job: { ...base, tm_invoiced_cents: 10700 } as never, payments: [pay(10000)] as never, costs: [] }).reason).toBe('not_funded')
      expect(derive({ job: { ...base, tm_invoiced_cents: 10700 } as never, payments: [pay(10700)] as never, costs: [] }).reason).toBeNull()
    }
    expect(waitingReasonText('not_funded', 10000, 5000, 700, 10700)).toBe('Customer still owes $7 of $107')
    expect(waitingReasonText('not_funded', 0, 5000, 0, 0)).toBe('Nothing invoiced yet')
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
      const withTax = (src.match(/evaluateJobCollection\(\{[^}]*(invoiceTaxCents|collectionInvoiceFields)/g) || []).length
      expect({ file: f, missing: calls - withTax }).toEqual({ file: f, missing: 0 })
      // …and the time & materials total (what a job billed by the hour owes), or the spread that carries both.
      const withTm = (src.match(/evaluateJobCollection\(\{[^}]*(timeAndMaterialsInvoicedCents|collectionInvoiceFields)/g) || []).length
      expect({ file: f, missingTimeAndMaterials: calls - withTm }).toEqual({ file: f, missingTimeAndMaterials: 0 })
    }
  })
})
