/** @jest-environment node */
/**
 * "Email invoice" on a JOB invoice really emails it (before: the button only marked it sent and nothing reached the
 * customer). Same sender as service invoices (lib/invoice-email.ts), the company's own From; email first, status second.
 */
const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/setter-email', () => ({ getMailTransport: () => ({ sendMail }), getCrmEmailFrom: () => 'ARX Decoy <decoy@product.example>' }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { sendCustomerInvoiceOnline } from '@/lib/online-payments/autopay'

type Row = Record<string, unknown>
const ORG = 'org-a'

function world(customerEmail: string | null = 'pat@example.com') {
  return createFakeDb(
    {
      orgs: [{ id: ORG, name: 'Acme Roofing', phone: '7045551234', email: 'office@acme.example', address: '1 Main St', settings: { brand: { legalName: 'Acme Roofing LLC' } }, timezone: 'America/New_York' }],
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat Doe', email: customerEmail, phone: null, address_text: '9 Elm St' }],
      production_jobs: [{ id: 'job1', org_id: ORG, customer_id: 'c1', address_text: '9 Elm St', project_id: null }],
      job_invoices: [{ id: 'inv1', org_id: ORG, job_id: 'job1', customer_id: null, invoice_number: 'INV-26-0100-1', invoice_kind: 'final', status: 'draft', subtotal_cents: 500000, tax_cents: 0, total_cents: 500000, due_at: null, public_note: null }],
      job_invoice_items: [{ id: 'it1', invoice_id: 'inv1', description: 'Roof replacement balance', qty: 1, unit_price_cents: 500000, line_total_cents: 500000, sort_order: 0, unit: 'each' }],
      invoice_payments: [],
      customer_message_suppressions: [],
      job_payments: [],
      projects: [],
      proposals: [],
    },
    { relations: { job_invoices: { job_invoice_items: { table: 'job_invoice_items', fk: 'invoice_id', many: true }, production_jobs: { table: 'production_jobs', fk: 'job_id' } } } }
  )
}

beforeEach(() => {
  sendMail.mockClear()
  process.env.SMTP_HOST = 'smtp.example'
})

describe('job invoice send', () => {
  const draft = (db: ReturnType<typeof world>) => (db.tables.job_invoices as Row[])[0] as never

  test('emails the customer from the company address, then marks the invoice sent', async () => {
    const db = world()
    const r = await sendCustomerInvoiceOnline(db.client as never, ORG, draft(db), null, 'u1')
    expect(r.ok).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = (sendMail.mock.calls[0] as unknown as [Record<string, string>])[0]
    expect(mail.from).toBe('Acme Roofing <office@acme.example>') // the company's own sender, never the product fallback
    expect(mail.replyTo).toBe('office@acme.example')
    expect(mail.to).toBe('pat@example.com')
    expect(mail.subject).toContain('INV-26-0100-1')
    expect(mail.html).toContain('$5,000.00')
    const inv = (db.tables.job_invoices as Row[])[0]
    expect(inv.status).toBe('sent')
    expect(inv.sent_to_email).toBe('pat@example.com')
  })

  test('an address typed in the box wins over the customer email', async () => {
    const db = world()
    await sendCustomerInvoiceOnline(db.client as never, ORG, draft(db), 'billing@pat.example', 'u1')
    expect((sendMail.mock.calls[0] as unknown as [Record<string, string>])[0].to).toBe('billing@pat.example')
  })

  test('a failed send leaves the invoice a draft; no address sends nothing', async () => {
    const db = world()
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    await expect(sendCustomerInvoiceOnline(db.client as never, ORG, draft(db), null, 'u1')).rejects.toThrow('smtp down')
    expect((db.tables.job_invoices as Row[])[0].status).toBe('draft')

    const none = world(null)
    const r = await sendCustomerInvoiceOnline(none.client as never, ORG, (none.tables.job_invoices as Row[])[0] as never, null, 'u1')
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect((none.tables.job_invoices as Row[])[0].status).toBe('draft')
  })

  test('a company with no email set sends nothing (no product fallback); a bounced or opted-out address is not emailed', async () => {
    const noEmail = world()
    ;(noEmail.tables.orgs as Row[])[0].email = null
    expect(await sendCustomerInvoiceOnline(noEmail.client as never, ORG, draft(noEmail), null, 'u1')).toMatchObject({ ok: false, status: 503 })

    const bounced = world()
    ;(bounced.tables.customer_message_suppressions as Row[]).push({ id: 's1', org_id: ORG, channel: 'email', address: 'pat@example.com', reason: 'bounce', created_at: '2026-11-01T00:00:00Z' })
    expect(await sendCustomerInvoiceOnline(bounced.client as never, ORG, draft(bounced), null, 'u1')).toMatchObject({ ok: false, status: 409 })

    const off = world()
    ;(off.tables.customers as Row[])[0].messages_off_at = '2026-11-02T00:00:00Z'
    expect(await sendCustomerInvoiceOnline(off.client as never, ORG, draft(off), null, 'u1')).toMatchObject({ ok: false, status: 409 })
    expect(sendMail).not.toHaveBeenCalled()
    expect((off.tables.job_invoices as Row[])[0].status).toBe('draft')
  })

  test('a void invoice is refused', async () => {
    const db = world()
    ;(db.tables.job_invoices as Row[])[0].status = 'void'
    expect(await sendCustomerInvoiceOnline(db.client as never, ORG, draft(db), null, 'u1')).toMatchObject({ ok: false, status: 409 })
    expect(sendMail).not.toHaveBeenCalled()
  })
})
