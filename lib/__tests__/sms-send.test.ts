/** @jest-environment node */
/**
 * Texts through the one send door (deliver) on a fake database: consent, opt-out, quiet hours across DST, the caps, one
 * text per key, the first-text STOP line, unknown outcomes, bad numbers and the STOP answer.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-precision'
process.env.DEPLOYMENT_ORG_ID = ORG
process.env.CUSTOMER_MESSAGE_LINK_SECRET = 'test-link-secret-0123456789'
process.env.SMS_PROVIDER = 'test'

jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: jest.fn(async () => 'https://precision.example.com') }))
jest.mock('@/lib/files/files-object', () => ({ orgLogoHref: () => null, signFilesObject: async (_a: unknown, p: string) => `https://storage.test/${p}` }))
jest.mock('@/lib/online-payments/accounts', () => ({ loadOnlinePayments: jest.fn(async () => ({ ready: false, settings: { autopay: false } })) }))
jest.mock('@/lib/online-payments/cards', () => ({ loadCardOnFile: jest.fn(async () => null) }))

import { runCustomerMessagesForOrg, sendComplianceText, sendStaffText } from '@/lib/customer-messages-db'
import { resetTestSms, setNextTestSmsResult, testSmsOutbox } from '@/lib/sms/test-provider'

type Row = Record<string, unknown>
function fakeClaim(a: Record<string, unknown>, t: Record<string, Row[]>) {
  const rows = t.customer_messages
  const row = rows.find((r) => r.id === a.p_id && r.org_id === a.p_org && r.status === a.p_from_status && r.attempts === a.p_attempts)
  if (!row) return 'not_claimed'
  const n = rows.filter(
    (r) =>
      r.org_id === a.p_org &&
      r.to_address === a.p_to &&
      r.id !== a.p_id &&
      String(r.sent_at ?? r.claimed_at ?? r.created_at ?? '') >= String(a.p_since) &&
      (r.status === 'sent' || r.status === 'sending' || (r.status === 'failed' && Number(r.attempts) < 3))
  ).length
  if (n >= Number(a.p_max)) {
    Object.assign(row, { status: 'skipped', skip_reason: 'daily_limit', to_address: a.p_to })
    return 'capped'
  }
  Object.assign(row, { status: 'sending', claimed_at: a.p_now, attempts: Number(a.p_attempts) + 1, to_address: a.p_to, link_token_hash: a.p_token_hash })
  return 'claimed'
}

const PHONE = '+18505550100'
const org = (settings: Record<string, unknown> = {}, tz = 'America/New_York') => ({
  id: ORG,
  name: 'Precision Maintenance',
  address: '12 Main St\nCrawfordville, FL 32327',
  phone: '8505550100',
  email: 'office@precision.test',
  timezone: tz,
  logo_url: null,
  settings: { features: { customerMessages: true, texting: true }, customerMessages: { visitReminder: true, visitReminderVia: 'text' }, brand: { website: 'precision.test' }, ...settings },
})

function seed(over: Record<string, unknown[]> = {}) {
  return createFakeDb(
    {
      orgs: [org()],
      users: [],
      customers: [{ id: 'c1', org_id: ORG, name: 'Jane Smith', email: 'jane@example.com', phone: '(850) 555-0100', messages_off_at: null, messages_off_by: null }],
      properties: [{ id: 'p1', org_id: ORG, address_text: '1 Oak St' }],
      service_plans: [{ id: 'plan1', org_id: ORG, name: 'Weekly lawn care', steps: [] }],
      work_orders: [],
      customer_messages: [],
      customer_message_suppressions: [],
      org_sms: [{ org_id: ORG, e164: '+18505550199', status: 'active', daily_cap: 300, provider: 'test', registration: {} }],
      customer_sms_consent: [{ id: 'k1', org_id: ORG, customer_id: 'c1', phone_e164: PHONE, status: 'granted', source: 'staff_phone', created_at: '2026-11-01T00:00:00Z', evidence: {} }],
      sms_inbound: [],
      sms_usage: [],
      activities: [{ id: 'a1', org_id: ORG, customer_id: 'c1', body: 'We can come at 10.', audience: 'customer', deleted_at: null }],
      ...over,
    },
    {
      unique: {
        customer_messages: [['org_id', 'message_key']],
        customer_message_suppressions: [['org_id', 'channel', 'address']],
        sms_usage: [['org_id', 'direction', 'provider_message_id']],
      },
      rpc: { customer_message_claim: fakeClaim },
    }
  )
}
const admin = (db: ReturnType<typeof seed>) => db.client as never
const msgs = (db: ReturnType<typeof seed>) => db.tables.customer_messages as unknown as Row[]
const act = (db: ReturnType<typeof seed>, n: number) => db.tables.activities.push({ id: `a${n}`, org_id: ORG, customer_id: 'c1', body: `Reply ${n}`, audience: 'customer', deleted_at: null })

const NOON = new Date('2026-11-11T17:00:00Z') // 12:00 EST

beforeEach(() => {
  resetTestSms()
})

describe('staff text', () => {
  it('goes out from the company number with the company name and the STOP line on the first text, then plain', async () => {
    const db = seed()
    expect(await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).toEqual({ status: 'sent' })
    expect(testSmsOutbox()).toHaveLength(1)
    expect(testSmsOutbox()[0]).toMatchObject({ from: '+18505550199', to: PHONE, text: 'Precision Maintenance: We can come at 10. Reply STOP to opt out.' })
    act(db, 2)
    await sendStaffText(admin(db), ORG, 'c1', 'a2', 'u1', new Date(NOON.getTime() + 60_000))
    expect(testSmsOutbox()[1].text).toBe('Reply 2')
    expect(msgs(db)[0]).toMatchObject({ channel: 'sms', kind: 'staff_reply', status: 'sent', segments: 1, delivery_status: 'sent' })
    expect((db.tables.sms_usage as Row[]).map((r) => r.direction)).toEqual(['out', 'out'])
  })
  it('one text per thread message: sending it again does nothing', async () => {
    const db = seed()
    await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('already')
    expect(testSmsOutbox()).toHaveLength(1)
  })
  it('no consent, no text; the customer texting first counts for 24 hours', async () => {
    const db = seed({ customer_sms_consent: [] })
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('skipped')
    expect(msgs(db)[0]).toMatchObject({ skip_reason: 'no_consent' })
    expect(testSmsOutbox()).toHaveLength(0)
    db.tables.sms_inbound.push({ id: 'i1', org_id: ORG, from_e164: PHONE, received_at: '2026-11-11T16:00:00Z', status: 'handled', kind: 'message' })
    act(db, 2)
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a2', 'u1', NOON)).status).toBe('sent')
  })
  it('an opt-out or a bad number blocks it, and a later consent row does not undo the opt-out', async () => {
    const db = seed({ customer_message_suppressions: [{ org_id: ORG, channel: 'sms', address: PHONE, reason: 'unsubscribed', created_at: '2026-11-10T00:00:00Z' }] })
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('skipped')
    expect(testSmsOutbox()).toHaveLength(0)
  })
  it('a revoked consent is the newest word', async () => {
    const db = seed()
    db.tables.customer_sms_consent.push({ id: 'k2', org_id: ORG, customer_id: 'c1', phone_e164: PHONE, status: 'revoked', source: 'portal', created_at: '2026-11-05T00:00:00Z', evidence: {} })
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('skipped')
  })
  it('the office "no messages" flag stops texts too', async () => {
    const db = seed()
    ;(db.tables.customers[0] as Row).messages_off_at = '2026-11-01T00:00:00Z'
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('skipped')
  })
  it('texting switch off, or no company number: nothing is sent', async () => {
    const off = seed({ orgs: [org({ features: { customerMessages: true } })] })
    expect((await sendStaffText(admin(off), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('off')
    const none = seed({ org_sms: [] })
    expect((await sendStaffText(admin(none), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('not_ready')
    const pending = seed({ org_sms: [{ org_id: ORG, e164: '+18505550199', status: 'brand_pending', daily_cap: 300, registration: {} }] })
    expect((await sendStaffText(admin(pending), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('not_ready')
    expect(testSmsOutbox()).toHaveLength(0)
  })
  it('the message is re-checked when it goes: taken back or no longer to the customer = cancelled', async () => {
    const db = seed()
    ;(db.tables.activities[0] as Row).audience = 'team'
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('cancelled')
    expect(testSmsOutbox()).toHaveLength(0)
  })
})

describe('texting hours (company time zone, DST)', () => {
  it('8 PM and later and before 8 AM wait; the row is kept and goes in the morning run', async () => {
    const db = seed()
    const night = new Date('2026-11-12T01:30:00Z') // 8:30 PM EST Wed
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', night)).status).toBe('queued')
    expect(testSmsOutbox()).toHaveLength(0)
    expect(msgs(db)[0].status).toBe('queued')
  })
  it('fall back: 12:30 UTC is 8:30 EDT on Oct 31 (sends) and 7:30 EST on Nov 1 (waits)', async () => {
    const a = seed()
    expect((await sendStaffText(admin(a), ORG, 'c1', 'a1', 'u1', new Date('2026-10-31T12:30:00Z'))).status).toBe('sent')
    const b = seed()
    expect((await sendStaffText(admin(b), ORG, 'c1', 'a1', 'u1', new Date('2026-11-01T12:30:00Z'))).status).toBe('queued')
    const c = seed()
    expect((await sendStaffText(admin(c), ORG, 'c1', 'a1', 'u1', new Date('2026-11-01T13:30:00Z'))).status).toBe('sent')
  })
  it('spring forward: 12:30 UTC is 7:30 EST on Mar 7 (waits) and 8:30 EDT on Mar 8 (sends); 7:30 PM EDT sends, 8:30 PM EDT waits', async () => {
    expect((await sendStaffText(admin(seed()), ORG, 'c1', 'a1', 'u1', new Date('2026-03-07T12:30:00Z'))).status).toBe('queued')
    expect((await sendStaffText(admin(seed()), ORG, 'c1', 'a1', 'u1', new Date('2026-03-08T12:30:00Z'))).status).toBe('sent')
    expect((await sendStaffText(admin(seed()), ORG, 'c1', 'a1', 'u1', new Date('2026-03-09T23:30:00Z'))).status).toBe('sent') // 7:30 PM EDT
    expect((await sendStaffText(admin(seed()), ORG, 'c1', 'a1', 'u1', new Date('2026-03-10T00:30:00Z'))).status).toBe('queued') // 8:30 PM EDT
  })
  it('another time zone is read from the company, not assumed', async () => {
    const db = seed({ orgs: [org({}, 'America/Los_Angeles')] })
    // 16:00 UTC = 8 AM PST: allowed; in New York it would be 11 AM too, so use 15:00 UTC = 7 AM PST: waits
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', new Date('2026-11-11T15:00:00Z'))).status).toBe('queued')
  })
  it('a staff reply to a customer who texted in the last 2 hours goes at any hour; the STOP answer always does', async () => {
    const night = new Date('2026-11-12T04:00:00Z') // 11 PM EST
    const db = seed({ sms_inbound: [{ id: 'i1', org_id: ORG, from_e164: PHONE, received_at: '2026-11-12T03:30:00Z', status: 'handled', kind: 'message' }] })
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', night)).status).toBe('sent')
    const old = seed({ sms_inbound: [{ id: 'i1', org_id: ORG, from_e164: PHONE, received_at: '2026-11-12T00:00:00Z', status: 'handled', kind: 'message' }] })
    expect((await sendStaffText(admin(old), ORG, 'c1', 'a1', 'u1', night)).status).toBe('queued')
    const stop = seed()
    expect(await sendComplianceText(admin(stop), ORG, { inboundId: 'in1', to: PHONE, text: 'Precision Maintenance: You are unsubscribed.', customerId: 'c1' }, night)).toBe('sent')
    expect(testSmsOutbox().at(-1)?.text).toBe('Precision Maintenance: You are unsubscribed.')
  })
})

describe('caps', () => {
  it('staff replies to one number: 30 a day, then no more; the company daily cap stops everything but the STOP answer', async () => {
    const db = seed({ org_sms: [{ org_id: ORG, e164: '+18505550199', status: 'active', daily_cap: 2, provider: 'test', registration: {} }] })
    for (let i = 2; i <= 4; i++) act(db, i)
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('sent')
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a2', 'u1', NOON)).status).toBe('sent')
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a3', 'u1', NOON)).status).toBe('queued')
    expect(testSmsOutbox()).toHaveLength(2)
    expect(await sendComplianceText(admin(db), ORG, { inboundId: 'in9', to: PHONE, text: 'Precision Maintenance: bye', customerId: 'c1' }, NOON)).toBe('sent')
  })
  it('automatic texts: 3 per number per day', async () => {
    const db = seed({ customer_messages: [] })
    for (let i = 0; i < 3; i++) {
      db.tables.customer_messages.push({ id: `old${i}`, org_id: ORG, channel: 'sms', kind: 'visit_reminder', message_key: `x${i}`, to_address: PHONE, status: 'sent', sent_at: '2026-11-11T13:00:00Z', attempts: 1, created_at: '2026-11-11T13:00:00Z' })
    }
    db.tables.work_orders.push({ id: 'v1', org_id: ORG, work_order_type: 'service_visit', status: 'scheduled', scheduled_date: '2026-11-12', service_planned_date: '2026-11-12', customer_id: 'c1', property_id: 'p1', service_plan_id: 'plan1', visit_step: 'service', address: null, title: 'Mow', completed_at: null })
    await runCustomerMessagesForOrg(admin(db), ORG, NOON)
    expect(testSmsOutbox()).toHaveLength(0)
  })
})

describe('outcomes', () => {
  it('a bad number is suppressed for good; a carrier "blocked" is an opt-out', async () => {
    const db = seed()
    setNextTestSmsResult(() => ({ ok: false, permanent: true, error: 'landline' }))
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('skipped')
    expect((db.tables.customer_message_suppressions as Row[])[0]).toMatchObject({ channel: 'sms', address: PHONE, reason: 'bounced' })
    const db2 = seed()
    setNextTestSmsResult(() => ({ ok: false, permanent: true, optedOut: true, error: 'blocked' }))
    await sendStaffText(admin(db2), ORG, 'c1', 'a1', 'u1', NOON)
    expect((db2.tables.customer_message_suppressions as Row[])[0]).toMatchObject({ reason: 'unsubscribed' })
  })
  it('an unknown outcome is never tried again', async () => {
    const db = seed()
    setNextTestSmsResult(() => ({ ok: false, permanent: false, unknown: true, error: 'timeout' }))
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('failed')
    setNextTestSmsResult(null)
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(NOON.getTime() + 24 * 3_600_000))
    expect(testSmsOutbox()).toHaveLength(0)
    expect(msgs(db)[0]).toMatchObject({ status: 'failed', attempts: 3 })
  })
  it('a temporary failure is retried later and sends once', async () => {
    const db = seed()
    setNextTestSmsResult(() => ({ ok: false, permanent: false, error: 'busy' }))
    expect((await sendStaffText(admin(db), ORG, 'c1', 'a1', 'u1', NOON)).status).toBe('failed')
    setNextTestSmsResult(null)
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(NOON.getTime() + 3 * 3_600_000))
    expect(testSmsOutbox()).toHaveLength(1)
  })
})

describe('automatic texts by choice', () => {
  const visit = { id: 'v1', org_id: ORG, work_order_type: 'service_visit', status: 'scheduled', scheduled_date: '2026-11-12', service_planned_date: '2026-11-12', customer_id: 'c1', property_id: 'p1', service_plan_id: 'plan1', visit_step: 'service', address: null, title: 'Weekly mow', completed_at: null }
  it('visit reminder set to Text goes by text only, company name first, STOP line on the first', async () => {
    const db = seed({ work_orders: [visit] })
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-11T14:30:00Z'))
    expect(testSmsOutbox()).toHaveLength(1)
    expect(testSmsOutbox()[0].text).toMatch(/^Precision Maintenance: We.ll be at your property tomorrow\./)
    expect(testSmsOutbox()[0].text.endsWith('Reply STOP to opt out.')).toBe(true)
    expect(msgs(db).map((m) => m.message_key)).toEqual(['visit_reminder:sms:c1:2026-11-12'])
  })
  it('without consent the reminder is not texted', async () => {
    const db = seed({ work_orders: [visit], customer_sms_consent: [] })
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-11T14:30:00Z'))
    expect(testSmsOutbox()).toHaveLength(0)
  })
  it('the default (email) never texts', async () => {
    const db = seed({ work_orders: [visit], orgs: [org({ customerMessages: { visitReminder: true } })] })
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-11T14:30:00Z'))
    expect(testSmsOutbox()).toHaveLength(0)
  })
})
