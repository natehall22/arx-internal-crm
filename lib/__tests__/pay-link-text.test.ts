/** @jest-environment node */
/**
 * "Text pay link" (sendPayLinkText): the ONE helper behind the crew page and the staff button. Same send door as every text
 * (consent, opt-out, hours, caps); the link is made only when the text goes and is never stored; nothing waits for later.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-precision'
process.env.DEPLOYMENT_ORG_ID = ORG
process.env.CUSTOMER_MESSAGE_LINK_SECRET = 'test-link-secret-0123456789'
process.env.SMS_PROVIDER = 'test'

const mockOnline = jest.fn(async () => ({ ready: true, settings: { autopay: false } }))
const mockInvoice = jest.fn()
const mockDoc = jest.fn()
const mockLink = jest.fn()
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: jest.fn(async () => 'https://precision.example.com') }))
jest.mock('@/lib/files/files-object', () => ({ orgLogoHref: () => null, signFilesObject: async (_a: unknown, p: string) => `https://storage.test/${p}` }))
jest.mock('@/lib/online-payments/accounts', () => ({ loadOnlinePayments: () => mockOnline() }))
jest.mock('@/lib/online-payments/cards', () => ({ loadCardOnFile: jest.fn(async () => null) }))
jest.mock('@/lib/online-payments/links', () => ({ createPaymentLink: (...a: unknown[]) => mockLink(...a) }))
jest.mock('@/lib/invoice-document', () => ({ ...jest.requireActual('@/lib/invoice-document'), loadInvoiceDocument: (...a: unknown[]) => mockDoc(...a) }))
jest.mock('@/lib/invoices', () => ({ ...jest.requireActual('@/lib/invoices'), findOrgInvoice: (...a: unknown[]) => mockInvoice(...a) }))

import { sendPayLinkText } from '@/lib/customer-messages-db'
import { payLinkTextMessage } from '@/lib/pay-link-text'
import { resetTestSms, testSmsOutbox } from '@/lib/sms/test-provider'

type Row = Record<string, unknown>
function fakeClaim(a: Record<string, unknown>, t: Record<string, Row[]>) {
  const row = t.customer_messages.find((r) => r.id === a.p_id && r.org_id === a.p_org && r.status === a.p_from_status && r.attempts === a.p_attempts)
  if (!row) return 'not_claimed'
  Object.assign(row, { status: 'sending', claimed_at: a.p_now, attempts: Number(a.p_attempts) + 1, to_address: a.p_to, link_token_hash: a.p_token_hash })
  return 'claimed'
}

const PHONE = '+18505550100'
const seed = (over: Record<string, unknown[]> = {}) =>
  createFakeDb(
    {
      orgs: [{ id: ORG, name: 'Precision Maintenance', address: '12 Main St\nCrawfordville, FL 32327', phone: '8505550100', email: 'office@precision.test', timezone: 'America/New_York', logo_url: null, settings: { features: { customerMessages: true, texting: true } } }],
      users: [],
      customers: [{ id: 'c1', org_id: ORG, name: 'Jane Smith', email: 'jane@example.com', phone: '(850) 555-0100', messages_off_at: null }],
      job_invoices: [{ id: 'inv1', customer_id: 'c1', job_id: null, status: 'sent', invoice_number: 'INV-26-00001', total_cents: 7000 }],
      customer_messages: [],
      customer_message_suppressions: [],
      org_sms: [{ org_id: ORG, e164: '+18505550199', status: 'active', daily_cap: 300, provider: 'test', registration: {} }],
      customer_sms_consent: [{ id: 'k1', org_id: ORG, customer_id: 'c1', phone_e164: PHONE, status: 'granted', source: 'staff_phone', created_at: '2026-11-01T00:00:00Z', evidence: {} }],
      sms_inbound: [],
      sms_usage: [],
      ...over,
    },
    { unique: { customer_messages: [['org_id', 'message_key']], customer_message_suppressions: [['org_id', 'channel', 'address']], sms_usage: [['org_id', 'direction', 'provider_message_id']] }, rpc: { customer_message_claim: fakeClaim } }
  )
type Db = ReturnType<typeof seed>
const admin = (db: Db) => db.client as never
const call = (db: Db, now: Date, createdBy: string | null = null) => sendPayLinkText(admin(db), ORG, { invoiceId: 'inv1', customerId: 'c1', createdBy }, now)

const NOON = new Date('2026-11-11T17:00:00Z') // 12:00 EST
const SECRET_URL = 'https://precision.example.com/pay/SECRETTOKENabcdefghijklmnopqrstuvwxyz0123456'

beforeEach(() => {
  resetTestSms()
  mockOnline.mockResolvedValue({ ready: true, settings: { autopay: false } })
  mockInvoice.mockImplementation(async (_c: unknown, id: string) => (id === 'inv1' ? { id: 'inv1', status: 'sent', job_id: null, customer_id: 'c1' } : null))
  mockDoc.mockResolvedValue({ isPaid: false, balanceCents: 7000, billTo: { name: 'Jane Smith', email: 'jane@example.com' } })
  mockLink.mockReset()
  mockLink.mockResolvedValue({ id: 'l1', url: SECRET_URL, expiresAt: '2027-01-01T00:00:00Z' })
})

describe('text pay link', () => {
  it('texts the link from the company number with the amount; the link is not stored anywhere in the log', async () => {
    const db = seed()
    expect(await call(db, NOON, 'u1')).toEqual({ status: 'sent' })
    const out = testSmsOutbox()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ from: '+18505550199', to: PHONE })
    expect(out[0].text).toContain('Precision Maintenance: Hi Jane, here is your link to pay invoice INV-26-00001 ($70.00): ')
    expect(out[0].text).toContain(SECRET_URL)
    expect(JSON.stringify(db.tables.customer_messages)).not.toContain('SECRETTOKEN')
    expect(db.tables.customer_messages[0]).toMatchObject({ kind: 'pay_link', channel: 'sms', status: 'sent', created_by: 'u1' })
  })

  it('a double tap inside ten minutes is one text and one link', async () => {
    const db = seed()
    await call(db, NOON)
    expect(await call(db, new Date(NOON.getTime() + 30_000))).toEqual({ status: 'sent' })
    expect(testSmsOutbox()).toHaveLength(1)
    expect(mockLink).toHaveBeenCalledTimes(1)
  })

  it('at most 3 an hour per invoice, then "too many" (the crew shows the QR code instead)', async () => {
    const db = seed()
    for (let i = 0; i < 3; i++) {
      const at = new Date(NOON.getTime() + i * 11 * 60_000)
      expect((await call(db, at)).status).toBe('sent')
      for (const r of db.tables.customer_messages) if (!r.created_at) r.created_at = at.toISOString() // the fake does not apply column defaults
    }
    expect((await call(db, new Date(NOON.getTime() + 35 * 60_000))).status).toBe('too_many')
    expect(testSmsOutbox()).toHaveLength(3)
    expect(payLinkTextMessage({ status: 'too_many' })).toMatch(/QR/)
  })

  it('no OK to text → nothing sent and no link made; the customer texting first does NOT open this (it is not a reply)', async () => {
    const db = seed({ customer_sms_consent: [] })
    db.tables.sms_inbound.push({ id: 'i1', org_id: ORG, from_e164: PHONE, received_at: '2026-11-11T16:00:00Z', status: 'handled', kind: 'message' })
    expect(await call(db, NOON)).toEqual({ status: 'blocked', reason: 'no_consent' })
    expect(testSmsOutbox()).toHaveLength(0)
    expect(mockLink).not.toHaveBeenCalled()
  })

  it('an opt-out blocks it', async () => {
    const db = seed({ customer_message_suppressions: [{ org_id: ORG, channel: 'sms', address: PHONE, reason: 'unsubscribed', created_at: '2026-11-10T00:00:00Z' }] })
    expect(await call(db, NOON)).toMatchObject({ status: 'blocked', reason: 'suppressed' })
    expect(testSmsOutbox()).toHaveLength(0)
  })

  it('outside texting hours it is NOT held for later: it is closed, and the scheduled run never sends it', async () => {
    const db = seed()
    const late = new Date('2026-11-12T03:00:00Z') // 10 PM EST
    expect(await call(db, late)).toEqual({ status: 'blocked', reason: 'outside_texting_hours' })
    expect(db.tables.customer_messages[0]).toMatchObject({ status: 'skipped', skip_reason: 'outside_texting_hours' })
    expect(testSmsOutbox()).toHaveLength(0)
    expect(mockLink).not.toHaveBeenCalled()
  })

  it('a paid, void or missing invoice, or online payments not ready, sends nothing', async () => {
    mockDoc.mockResolvedValueOnce({ isPaid: true, balanceCents: 0, billTo: { name: 'Jane', email: null } })
    expect((await call(seed(), NOON)).status).toBe('blocked')
    mockInvoice.mockResolvedValueOnce({ id: 'inv1', status: 'void', job_id: null, customer_id: 'c1' })
    expect((await call(seed(), NOON)).status).toBe('blocked')
    mockOnline.mockResolvedValueOnce({ ready: false, settings: { autopay: false } })
    expect(await call(seed(), NOON)).toMatchObject({ status: 'blocked', reason: 'online_payments_not_ready' })
    expect(testSmsOutbox()).toHaveLength(0)
  })

  it('texting off or no company number → plain refusals', async () => {
    const off = seed({ orgs: [{ id: ORG, name: 'P', address: 'x', phone: '1', email: 'a@b.c', timezone: 'America/New_York', settings: { features: { customerMessages: true } } }] })
    expect(await call(off, NOON)).toMatchObject({ status: 'off' })
    expect(await call(seed({ org_sms: [] }), NOON)).toMatchObject({ status: 'off', reason: 'not_ready' })
    expect(payLinkTextMessage({ status: 'blocked', reason: 'no_consent' })).toMatch(/OK to text/)
    expect(payLinkTextMessage({ status: 'blocked', reason: 'no_address' })).toMatch(/phone number/)
  })
})
