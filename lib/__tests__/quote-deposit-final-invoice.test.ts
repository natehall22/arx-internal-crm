/** @jest-environment node */
/**
 * A quote's deposit is a payment on account, never extra revenue: the final invoice is the sale amount minus the deposit
 * already applied, the two invoices add up to the approved total, and paid-in-full (lib/job-collection.ts) reads the
 * deposit + the final payment as the sale amount.
 */
import { createFinalInvoice, getDepositInfo } from '@/lib/invoices'
import { evaluateJobCollection } from '@/lib/job-collection'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const seed = () => ({
  production_jobs: [{ id: 'j1', org_id: 'org-1', sale_amount: 400, deposit_required_percent: 0.25 }],
  job_invoices: [{ id: 'dep', org_id: 'org-1', job_id: 'j1', invoice_kind: 'deposit', status: 'paid', total_cents: 10000 }],
  invoice_payments: [{ id: 'ip1', invoice_id: 'dep', applied_cents: 10000 }],
  job_payments: [{ id: 'p1', job_id: 'j1', payment_type: 'deposit', amount_cents: 10000 }],
})

describe('quote deposit and the final invoice', () => {
  it('final invoice = sale amount - applied deposit', async () => {
    const db = createFakeDb(seed())
    const info = await getDepositInfo(db.client, 'j1')
    expect(info.appliedDepositCents).toBe(10000)
    const inv = await createFinalInvoice(db.client, 'j1', 'u1')
    expect(inv.total_cents).toBe(30000)
    // Customer's bill: deposit invoice + final invoice = the approved total, not more.
    const billed = db.tables.job_invoices.filter((i) => i.status !== 'void').reduce((n, i) => n + Number(i.total_cents), 0)
    expect(billed).toBe(40000)
  })

  it('deposit + final payment collect the sale amount: paid in full, not overpaid', () => {
    const c = evaluateJobCollection({ saleAmount: 400, payments: [{ amount_cents: 10000 }, { amount_cents: 30000 }] })
    expect(c.paidInFull).toBe(true)
    expect(c.remainingCents).toBe(0)
  })

  it('the deposit alone is not paid in full', () => {
    expect(evaluateJobCollection({ saleAmount: 400, payments: [{ amount_cents: 10000 }] }).paidInFull).toBe(false)
  })
})
