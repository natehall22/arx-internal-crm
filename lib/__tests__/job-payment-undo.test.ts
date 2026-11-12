/** @jest-environment node */
/**
 * "Undo payment": a payment is never deleted — a negative payment goes through the one writer, and everything that reads
 * payments (paid in full, the invoice, QuickBooks outbox) follows. Totals are proven in integer cents.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { FAKE_PAYMENT_RPC } from '@/lib/test-helpers/fake-payment-rpc'

jest.mock('@/lib/job-payment-email', () => ({ notifyAdminOpsOfJobPayment: jest.fn(async () => undefined) }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://acme.crm.test', tryOrgAppUrl: async () => 'https://acme.crm.test' }))

import { undoJobPayment } from '@/lib/job-payment-undo'
import { undoRefusal } from '@/lib/job-payment-undo-rules'
import { evaluateJobCollection } from '@/lib/job-collection'

type Row = Record<string, unknown>
const ORG = 'org-a'
const owner = { id: 'u-owner', isOwner: true }
const office = { id: 'u-office', isOwner: false }

function world(extra: Record<string, Row[]> = {}) {
  return createFakeDb(
    {
      orgs: [{ id: ORG, name: 'Acme', timezone: 'America/Chicago', settings: { features: { quickbooks: true } } }],
      production_jobs: [{ id: 'job1', org_id: ORG, job_number: '26-1', customer_id: 'c1', address_text: '1 Oak', sale_amount: 100, status: 'sold', billing_mode: 'fixed' }],
      job_invoices: [{ id: 'inv1', org_id: ORG, job_id: 'job1', status: 'paid', total_cents: 10000, tax_cents: 0 }],
      job_payments: [
        { id: 'p1', job_id: 'job1', paid_at: '2026-11-01', amount_cents: 10000, payment_type: 'final', method: 'check', payer: 'homeowner', note: null, idempotency_key: null },
        { id: 'p-stripe', job_id: 'job1', paid_at: '2026-11-01', amount_cents: 500, payment_type: 'other', method: 'card', payer: 'homeowner', note: null, idempotency_key: 'stripe:pi_1' },
      ],
      invoice_payments: [{ id: 'ip0', invoice_id: 'inv1', job_payment_id: 'p1', applied_cents: 10000 }],
      integration_outbox: [],
      payroll_job_snapshots: [],
      payroll_periods: [],
      ...extra,
    },
    { rpc: FAKE_PAYMENT_RPC, relations: { job_invoices: { production_jobs: { table: 'production_jobs', fk: 'job_id' } } } }
  )
}
const collected = (db: ReturnType<typeof world>, skip: string[] = ['p-stripe']) => {
  const rows = (db.tables.job_payments as Row[]).filter((p) => !skip.includes(String(p.id)))
  return evaluateJobCollection({ saleAmount: 100, payments: rows as never })
}

describe('undoJobPayment', () => {
  test('writes a negative row, keeps the original, re-opens the invoice and the job, queues QuickBooks', async () => {
    const db = world()
    expect(collected(db).paidInFull).toBe(true)
    const r = await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p1', reason: 'Check bounced', actor: office })
    expect(r.ok).toBe(true)
    const pays = db.tables.job_payments as Row[]
    expect(pays.find((p) => p.id === 'p1')?.amount_cents).toBe(10000) // original untouched
    const rev = pays.find((p) => p.idempotency_key === 'undo:p1')!
    expect(rev.amount_cents).toBe(-10000)
    expect(rev.created_by).toBe('u-office')
    expect(String(rev.note)).toContain('Check bounced')
    // totals: sum 0, no longer paid in full
    const c = collected(db)
    expect(c.collectedCents).toBe(0)
    expect(c.remainingCents).toBe(10000)
    expect(c.paidInFull).toBe(false)
    // invoice back to unpaid, balance re-opened by exactly the payment
    expect((db.tables.job_invoices as Row[])[0].status).toBe('sent')
    expect((db.tables.invoice_payments as Row[]).reduce((s, a) => s + Number(a.applied_cents), 0)).toBe(0)
    // QuickBooks event
    expect((db.tables.integration_outbox as Row[]).map((o) => o.event_type)).toEqual(['payment.refunded'])
  })

  test('a double tap writes nothing new', async () => {
    const db = world()
    await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p1', reason: 'x', actor: office })
    const again = await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p1', reason: 'x', actor: office })
    expect(again).toMatchObject({ ok: true, alreadyUndone: true })
    expect((db.tables.job_payments as Row[]).filter((p) => p.idempotency_key === 'undo:p1')).toHaveLength(1)
    expect(collected(db).collectedCents).toBe(0)
    expect((db.tables.integration_outbox as Row[])).toHaveLength(1)
  })

  test('reason is required; online payments, reversals and other jobs are refused', async () => {
    const db = world()
    expect(await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p1', reason: '  ', actor: office })).toMatchObject({ ok: false, status: 400 })
    expect(await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p-stripe', reason: 'x', actor: owner })).toMatchObject({ ok: false, status: 409 })
    expect(await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job2', paymentId: 'p1', reason: 'x', actor: owner })).toMatchObject({ ok: false, status: 404 })
    expect(await undoJobPayment(db.client as never, { orgId: 'org-b', jobId: 'job1', paymentId: 'p1', reason: 'x', actor: owner })).toMatchObject({ ok: false, status: 404 })
    expect(undoRefusal({ amount_cents: -100 })).toMatch(/refund/)
    expect(db.tables.job_payments as Row[]).toHaveLength(2)
  })

  test('money already in an approved pay week: only an owner may undo', async () => {
    const db = world({ payroll_job_snapshots: [{ job_id: 'job1', payroll_period_id: 'wk1' }], payroll_periods: [{ id: 'wk1', org_id: ORG, status: 'locked' }] })
    expect(await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p1', reason: 'x', actor: office })).toMatchObject({ ok: false, status: 403 })
    expect((db.tables.job_payments as Row[])).toHaveLength(2)
    expect((await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p1', reason: 'Wrong job', actor: owner })).ok).toBe(true)
  })

  test('a payment never applied to an invoice only writes the reversal', async () => {
    const db = world({ invoice_payments: [], job_invoices: [{ id: 'inv1', org_id: ORG, job_id: 'job1', status: 'sent', total_cents: 10000, tax_cents: 0 }] })
    expect((await undoJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paymentId: 'p1', reason: 'x', actor: office })).ok).toBe(true)
    expect(db.tables.invoice_payments as Row[]).toHaveLength(0)
    expect((db.tables.job_invoices as Row[])[0].status).toBe('sent')
  })
})
