/** @jest-environment node */
/**
 * The customer's receipt: one function, sent from BOTH payment writers (job payments and invoices without a job), in the
 * company's own layout, only for companies with Automatic customer emails on, never for refunds / repeats, opt-outs respected.
 */
const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/setter-email', () => ({ getMailTransport: () => ({ sendMail }), getCrmEmailFrom: async () => 'decoy@product.example' }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://acme.crm.test', tryOrgAppUrl: async () => 'https://acme.crm.test' }))
let featureOn = true
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: async () => featureOn }))
jest.mock('@/lib/integrations', () => ({ ...jest.requireActual('@/lib/integrations'), enqueuePaymentRecorded: async () => undefined }))
jest.mock('@/lib/job-commission-base', () => ({ ...jest.requireActual('@/lib/job-commission-base'), syncTimeAndMaterialsCommissionBase: async () => null, followPaidCommissionBase: async () => undefined }))
jest.mock('@/lib/job-payment-email', () => ({ notifyAdminOpsOfJobPayment: async () => undefined }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { FAKE_PAYMENT_RPC } from '@/lib/test-helpers/fake-payment-rpc'
import { recordCustomerInvoicePayment } from '@/lib/invoices'
import { recordJobPayment } from '@/lib/job-payment-record'
import { renderPaymentReceipt, sendPaymentReceipt } from '@/lib/payment-receipt'

const ORG = 'org-a'
type Row = Record<string, unknown>
const company = { name: 'Acme Lawn', phone: '(704) 555-1234', email: 'office@acme.example', website: '', addressLine: '1 Main St', logoUrl: null }

function world(customerEmail: string | null = 'pat@example.com', extra: Record<string, Row[]> = {}) {
  return createFakeDb(
    {
      orgs: [{ id: ORG, name: 'Acme Lawn', phone: '7045551234', email: 'office@acme.example', address: '1 Main St', settings: {}, timezone: 'America/New_York' }],
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat Doe', email: customerEmail, messages_off_at: null }],
      production_jobs: [{ id: 'job1', org_id: ORG, customer_id: 'c1', job_number: '26-1', address_text: '9 Elm St', sale_amount: 1000 }],
      job_invoices: [{ id: 'inv1', org_id: ORG, job_id: null, customer_id: 'c1', invoice_number: 'INV-1', invoice_kind: 'service', status: 'sent', total_cents: 10000, tax_cents: 0, subtotal_cents: 10000, due_at: '2026-11-10', issued_at: '2026-11-01' }],
      job_invoice_items: [{ id: 'i1', invoice_id: 'inv1', description: 'Mowing', qty: 1, unit_price_cents: 10000, line_total_cents: 10000, sort_order: 0 }],
      invoice_payments: [],
      job_payments: [],
      customer_message_suppressions: [],
      projects: [],
      proposals: [],
      ...extra,
    },
    {
      relations: { job_invoices: { job_invoice_items: { table: 'job_invoice_items', fk: 'invoice_id', many: true } } },
      rpc: {
        ...FAKE_PAYMENT_RPC,
        record_customer_invoice_payment: (a, t) => {
          const dup = a.p_idempotency_key && (t.job_payments ?? []).find((p) => p.idempotency_key === a.p_idempotency_key)
          const pay = (dup || { id: `cp-${(t.job_payments ?? []).length + 1}`, job_id: null, amount_cents: a.p_amount_cents, idempotency_key: a.p_idempotency_key ?? null }) as Row
          if (!dup) {
            ;(t.job_payments ??= []).push(pay)
            ;(t.invoice_payments ??= []).push({ id: `ap-${pay.id}`, invoice_id: a.p_invoice, job_payment_id: pay.id, applied_cents: a.p_amount_cents })
          }
          const inv = (t.job_invoices ?? []).find((i) => i.id === a.p_invoice)!
          const paid = (t.invoice_payments ?? []).filter((x) => x.invoice_id === a.p_invoice).reduce((s, x) => s + Number(x.applied_cents), 0)
          inv.status = paid >= Number(inv.total_cents) ? 'paid' : 'partially_paid'
          return { payment_id: pay.id, status: inv.status, balance_cents: Number(inv.total_cents) - paid, duplicate: !!dup }
        },
      },
    }
  )
}

beforeEach(() => {
  sendMail.mockClear()
  featureOn = true
  process.env.SMTP_HOST = 'smtp.example'
})

const mail = () => (sendMail.mock.calls[0] as unknown as [Record<string, string>])[0]

describe('renderPaymentReceipt', () => {
  test('the company layout: its name, the amount, how, what is still owed — never the product', () => {
    const r = renderPaymentReceipt({ company, customerName: 'Pat Doe', amountCents: 4500, paidAt: '2026-11-11', method: 'check', invoiceNumber: 'INV-1', remainingCents: 5500 })
    expect(r.subject).toBe('Receipt for your $45.00 payment — Acme Lawn')
    expect(r.html).toContain('Acme Lawn')
    expect(r.text).toContain('Amount: $45.00')
    expect(r.text).toContain('Paid by: Check')
    expect(r.text).toContain('Still owed: $55.00')
    expect(r.text).toContain('Nov 11, 2026')
    expect(r.text).not.toMatch(/ARX/i)
    expect(r.html).not.toContain('Stop these automatic emails') // a receipt is not a marketing email
  })
  test('paid in full', () => {
    expect(renderPaymentReceipt({ company, customerName: null, amountCents: 100, paidAt: '2026-11-11', method: 'card', remainingCents: 0 }).text).toContain('paid in full')
  })
})

describe('invoice without a job (Mark paid, door cash/check, online)', () => {
  const pay = (db: ReturnType<typeof world>, key?: string) => recordCustomerInvoicePayment(db.client as never, ORG, 'inv1', { amountCents: 4000, paidAt: '2026-11-11', method: 'cash', createdBy: 'u1', idempotencyKey: key })

  test('emails the receipt from the company address with the balance left', async () => {
    const r = await pay(world())
    expect(r.ok).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(mail().to).toBe('pat@example.com')
    expect(mail().from).toBe('Acme Lawn <office@acme.example>')
    expect(mail().text).toContain('Invoice: INV-1')
    expect(mail().text).toContain('Still owed: $60.00')
  })
  test('a repeat of the same payment sends nothing more', async () => {
    const db = world()
    await pay(db, 'k1')
    await pay(db, 'k1')
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
  test('off for companies without Automatic customer emails (roofing unchanged)', async () => {
    featureOn = false
    await pay(world())
    expect(sendMail).not.toHaveBeenCalled()
  })
  test('opted-out address, customer who turned messages off, no email: no receipt, payment still recorded', async () => {
    const off = world('pat@example.com', { customer_message_suppressions: [{ org_id: ORG, channel: 'email', address: 'pat@example.com', reason: 'unsubscribed' }] })
    expect((await pay(off)).ok).toBe(true)
    const none = world(null)
    expect((await pay(none)).ok).toBe(true)
    const muted = world()
    ;(muted.tables.customers as Row[])[0].messages_off_at = '2026-01-01T00:00:00Z'
    expect((await pay(muted)).ok).toBe(true)
    expect(sendMail).not.toHaveBeenCalled()
  })
  test('a mail failure never fails the payment', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await pay(world())).ok).toBe(true)
    spy.mockRestore()
  })
})

describe('job payment (office Add payment, online on a job invoice)', () => {
  const rec = (db: ReturnType<typeof world>, amountCents: number, key?: string) =>
    recordJobPayment(db.client as never, { orgId: ORG, jobId: 'job1', paidAt: '2026-11-11', amountCents, paymentType: 'deposit', method: 'check', payer: 'homeowner', createdBy: 'u1', idempotencyKey: key })

  test('receipt names the address and what the job still owes', async () => {
    const r = await rec(world(), 25000)
    expect(r.ok).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(mail().text).toContain('For: 9 Elm St')
    expect(mail().text).toContain('Amount: $250.00')
  })
  test('a refund (negative) and a repeat send nothing', async () => {
    const db = world()
    await rec(db, 25000, 'k')
    sendMail.mockClear()
    await rec(db, 25000, 'k') // repeat
    await rec(db, -5000) // refund
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('sendPaymentReceipt', () => {
  test('skips what is not money in', async () => {
    expect(await sendPaymentReceipt(world().client as never, ORG, { paymentId: 'x', amountCents: 0, paidAt: '2026-11-11', method: 'cash', invoiceId: 'inv1' })).toBe('skipped')
  })
})
