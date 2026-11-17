/** @jest-environment node */
/** Customer statement: open invoices oldest-due first with how late, payments of the last 90 days, emailed by hand through the invoice-email sender rules. */
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://acme.crm.test', tryOrgAppUrl: async () => 'https://acme.crm.test' }))
const sendMail = jest.fn(async () => ({}))
jest.mock('@/lib/setter-email', () => ({ getMailTransport: () => ({ sendMail }), getCrmEmailFrom: async () => 'decoy@product.example' }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { emailCustomerStatement, loadCustomerStatement, renderStatementEmail, statementTotals } from '@/lib/customer-statement'

const ORG = 'org-a'
const inv = (id: string, o: Record<string, unknown>) => ({ id, org_id: ORG, job_id: null, customer_id: 'c1', invoice_number: `INV-${id}`, status: 'sent', total_cents: 10000, due_at: '2026-11-01', issued_at: '2026-10-25', created_at: `2026-10-25T00:00:0${id}Z`, ...o })

function db(email: string | null = 'pat@example.com') {
  return createFakeDb({
    orgs: [{ id: ORG, name: 'Acme Lawn', phone: '7045551234', email: 'office@acme.example', address: '1 Main St', settings: {}, timezone: 'America/New_York' }],
    customers: [{ id: 'c1', org_id: ORG, name: 'Pat Lee', email, address_text: '9 Elm', messages_off_at: null }, { id: 'c9', org_id: 'org-b', name: 'Other' }],
    production_jobs: [],
    job_invoices: [
      inv('1', { due_at: '2026-11-20' }), // not due yet
      inv('2', { due_at: '2026-10-01', issued_at: '2026-09-20', created_at: '2026-09-20T00:00:00Z' }), // 41 days late
      inv('3', { status: 'paid' }),
      inv('4', { status: 'void' }),
    ],
    invoice_payments: [
      { id: 'a', invoice_id: '3', job_payment_id: 'p1', applied_cents: 10000 },
      { id: 'b', invoice_id: '2', job_payment_id: 'p2', applied_cents: 2000 },
      { id: 'c', invoice_id: '3', job_payment_id: 'p3', applied_cents: 500 },
    ],
    job_payments: [
      { id: 'p1', paid_at: '2026-11-05', method: 'check' },
      { id: 'p2', paid_at: '2026-10-15', method: 'cash' },
      { id: 'p3', paid_at: '2026-06-01', method: 'card' }, // older than 90 days
    ],
    customer_message_suppressions: [],
  })
}

beforeEach(() => {
  sendMail.mockClear()
  process.env.SMTP_HOST = 'smtp.example'
  jest.useFakeTimers().setSystemTime(new Date('2026-11-11T15:00:00Z'))
})
afterEach(() => jest.useRealTimers())

describe('statement', () => {
  test('open invoices oldest due first with days late, totals, payments of the last 90 days only', async () => {
    const s = (await loadCustomerStatement(db().client as never, ORG, 'c1'))!
    expect(s.open.map((r) => r.id)).toEqual(['2', '1'])
    expect(s.open[0].daysOverdue).toBe(41)
    expect(s.owedCents).toBe(8000 + 10000)
    expect(s.overdueCents).toBe(8000)
    expect(s.payments.map((p) => [p.invoiceNumber, p.amountCents, p.paidAt])).toEqual([['INV-3', 10000, '2026-11-05'], ['INV-2', 2000, '2026-10-15']])
  })
  test('another company’s customer is not found', async () => {
    expect(await loadCustomerStatement(db().client as never, ORG, 'c9')).toBeNull()
  })
  test('totals are pure', () => expect(statementTotals([{ balanceCents: 100, daysOverdue: 3 }, { balanceCents: 50, daysOverdue: 0 }])).toEqual({ owedCents: 150, overdueCents: 100 }))
})

describe('email', () => {
  test('lists what is open, how late, from the company address', async () => {
    const d = db()
    const s = (await loadCustomerStatement(d.client as never, ORG, 'c1'))!
    const r = await emailCustomerStatement(d.client as never, ORG, s)
    expect(r).toEqual({ ok: true, to: 'pat@example.com' })
    const m = (sendMail.mock.calls[0] as unknown as [Record<string, string>])[0]
    expect(m.from).toBe('Acme Lawn <office@acme.example>')
    expect(m.text).toContain('Invoice INV-2: $80.00')
    expect(m.text).toContain('41 days late')
    expect(m.text).toContain('$180.00 in total')
  })
  test('paid up says so', async () => {
    const d = db()
    const s = (await loadCustomerStatement(d.client as never, ORG, 'c1'))!
    expect(renderStatementEmail({ name: 'Acme', phone: '', email: '', website: '', addressLine: '' }, { ...s, open: [], owedCents: 0, overdueCents: 0 }).text).toContain('paid up')
  })
  test('no email on file, or opted out: refused with a sentence, nothing sent', async () => {
    const none = db(null)
    expect(await emailCustomerStatement(none.client as never, ORG, (await loadCustomerStatement(none.client as never, ORG, 'c1'))!)).toMatchObject({ ok: false, status: 400 })
    const out = db()
    ;(out.tables.customers as Array<Record<string, unknown>>)[0].messages_off_at = '2026-01-01T00:00:00Z'
    expect(await emailCustomerStatement(out.client as never, ORG, (await loadCustomerStatement(out.client as never, ORG, 'c1'))!)).toMatchObject({ ok: false, status: 409 })
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('email send failure', () => {
  test('a mail error becomes a clear sentence, not a 500', async () => {
    const d = db()
    const s = (await loadCustomerStatement(d.client as never, ORG, 'c1'))!
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await emailCustomerStatement(d.client as never, ORG, s)).toMatchObject({ ok: false, status: 502, error: expect.stringContaining('could not be sent') })
    spy.mockRestore()
  })
})
