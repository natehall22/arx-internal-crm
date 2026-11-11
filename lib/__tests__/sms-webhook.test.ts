/** @jest-environment node */
/**
 * The texting webhook end to end (route → processSmsEvent) on a fake database with the test carrier: who it believes,
 * which company a text belongs to, STOP / HELP / START, dedupe, unknown numbers, shared numbers, delivery receipts and
 * attacks (forged / replayed / cross-company).
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-a'
const OTHER = 'org-b'
process.env.SMS_PROVIDER = 'test'
process.env.SMS_TEST_WEBHOOK_TOKEN = 'test-webhook-token'
process.env.CUSTOMER_MESSAGE_LINK_SECRET = 'test-link-secret-0123456789'
delete process.env.DEPLOYMENT_ORG_ID

let db: ReturnType<typeof makeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const deferred: Array<Promise<unknown>> = []
jest.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => void deferred.push(p) }))
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: jest.fn(async () => 'https://a.example.com') }))
jest.mock('@/lib/portal/messages', () => ({ notifyCompanyOfPortalMessage: jest.fn(async () => undefined) }))

import { POST } from '@/app/api/webhooks/sms/telnyx/route'
import { resetTestSms, testSmsOutbox } from '@/lib/sms/test-provider'

type Row = Record<string, unknown>
const CO_A = '+18505550199'
const CO_B = '+18505550188'
const CUST = '+18505550100'

function makeDb() {
  return createFakeDb(
    {
      orgs: [
        { id: ORG, name: 'Alpha Roofing', phone: '8505550150', email: 'office@alpha.test', timezone: 'America/New_York', address: '1 Main', logo_url: null, settings: { features: { texting: true, customerMessages: true }, brand: {} } },
        { id: OTHER, name: 'Bravo Roofing', phone: '8505550151', email: 'office@bravo.test', timezone: 'America/New_York', address: '2 Main', logo_url: null, settings: { features: { texting: true }, brand: {} } },
      ],
      org_sms: [
        { org_id: ORG, e164: CO_A, status: 'active', provider: 'test', daily_cap: 300, registration: {} },
        { org_id: OTHER, e164: CO_B, status: 'active', provider: 'test', daily_cap: 300, registration: {} },
      ],
      customers: [
        { id: 'c1', org_id: ORG, name: 'Jane', phone: '(850) 555-0100', email: 'jane@x.test', messages_off_at: null },
        { id: 'cb', org_id: OTHER, name: 'Bob', phone: '(850) 555-0100', email: 'bob@x.test', messages_off_at: null },
      ],
      opportunities: [],
      threads: [],
      activities: [],
      users: [],
      customer_messages: [],
      customer_message_suppressions: [],
      customer_sms_consent: [],
      sms_inbound: [],
      sms_usage: [],
    },
    {
      unique: { sms_inbound: [['org_id', 'provider_message_id']], customer_message_suppressions: [['org_id', 'channel', 'address']], customer_messages: [['org_id', 'message_key']], sms_usage: [['org_id', 'direction', 'provider_message_id']] },
      rpc: {
        portal_find_customers: (a, t) => (t.customers as Row[]).filter((c) => c.org_id === a.p_org && String(c.phone).replace(/\D/g, '').slice(-10) === a.p_phone10).map((c) => ({ id: c.id })),
        customer_message_claim: (a, t) => {
          const row = (t.customer_messages as Row[]).find((r) => r.id === a.p_id)
          if (!row) return 'not_claimed'
          Object.assign(row, { status: 'sending', attempts: Number(a.p_attempts) + 1, to_address: a.p_to })
          return 'claimed'
        },
      },
    }
  )
}

function inboundBody(id: string, text: string, to = CO_A, from = CUST) {
  return JSON.stringify({ data: { event_type: 'message.received', occurred_at: '2026-11-11T17:00:00Z', payload: { id, text, from: { phone_number: from }, to: [{ phone_number: to }], media: [], parts: 1 } } })
}
async function call(body: string, token: string | null = 'test-webhook-token') {
  const res = await POST(new Request('https://anything.example.com/api/webhooks/sms/telnyx', { method: 'POST', headers: token ? { 'x-test-sms-token': token } : {}, body }))
  await Promise.all(deferred.splice(0)) // the carrier-required answer finishes behind the response
  return res
}
const table = (n: string) => db.tables[n] as Row[]

beforeEach(() => {
  db = makeDb()
  resetTestSms()
  delete process.env.DEPLOYMENT_ORG_ID
  delete process.env.SMS_COMPLIANCE_AUTO_REPLY
})

describe('who is believed', () => {
  it('no token, a wrong token, a bad body: refused and nothing is written', async () => {
    expect((await call(inboundBody('m1', 'hi'), null)).status).toBe(400)
    expect((await call(inboundBody('m1', 'hi'), 'wrong')).status).toBe(400)
    expect((await call('not json')).status).toBe(400)
    expect(table('sms_inbound')).toHaveLength(0)
  })
  it('an unconfigured copy says so instead of guessing', async () => {
    delete process.env.SMS_TEST_WEBHOOK_TOKEN
    expect((await call(inboundBody('m1', 'hi'))).status).toBe(503)
    process.env.SMS_TEST_WEBHOOK_TOKEN = 'test-webhook-token'
  })
  it('a huge body is refused', async () => {
    expect((await call(inboundBody('m1', 'x'.repeat(300_000)))).status).toBe(413)
  })
  it('in production the test carrier is never trusted', async () => {
    const env = process.env as Record<string, string | undefined>
    const was = env.NODE_ENV
    env.NODE_ENV = 'production'
    delete process.env.TELNYX_PUBLIC_KEY
    const res = await call(inboundBody('m1', 'hi'))
    env.NODE_ENV = was
    expect(res.status).toBe(503)
    expect(table('sms_inbound')).toHaveLength(0)
  })
})

describe('which company', () => {
  it('the company number decides, not the address the request came to', async () => {
    await call(inboundBody('m1', 'hello'))
    expect(table('sms_inbound')[0]).toMatchObject({ org_id: ORG, customer_id: 'c1' })
    await call(inboundBody('m2', 'hello b', CO_B))
    expect(table('sms_inbound').find((r) => r.provider_message_id === 'm2')).toMatchObject({ org_id: OTHER, customer_id: 'cb' })
    expect(table('activities').map((a) => [a.org_id, a.customer_id])).toEqual([[ORG, 'c1'], [OTHER, 'cb']])
  })
  it('a text to a number that is nobody’s is ignored (200, nothing written)', async () => {
    const res = await call(inboundBody('m1', 'STOP', '+18505550000'))
    expect(res.status).toBe(200)
    expect(table('sms_inbound')).toHaveLength(0)
    expect(table('customer_message_suppressions')).toHaveLength(0)
  })
  it('a copy fenced to another company ignores this company’s number', async () => {
    process.env.DEPLOYMENT_ORG_ID = OTHER
    await call(inboundBody('m1', 'hello'))
    expect(table('sms_inbound')).toHaveLength(0)
  })
  it('a STOP to company A never suppresses the number at company B', async () => {
    await call(inboundBody('m1', 'STOP'))
    expect(table('customer_message_suppressions').map((r) => r.org_id)).toEqual([ORG])
  })
})

describe('keywords', () => {
  it('STOP: suppressed, a revoke row, one confirmation, in the customer’s thread', async () => {
    await call(inboundBody('m1', 'STOP'))
    expect(table('customer_message_suppressions')[0]).toMatchObject({ org_id: ORG, channel: 'sms', address: CUST, reason: 'unsubscribed' })
    expect(table('customer_sms_consent')[0]).toMatchObject({ status: 'revoked', source: 'sms_stop', customer_id: 'c1' })
    expect(testSmsOutbox()).toHaveLength(1)
    expect(testSmsOutbox()[0]).toMatchObject({ to: CUST, from: CO_A })
    expect(testSmsOutbox()[0].text).toMatch(/^Alpha Roofing: You are unsubscribed/)
    expect(table('activities')[0]).toMatchObject({ origin: 'sms', audience: 'team', type: 'text', body: 'STOP' })
  })
  it('a repeat delivery of the same STOP does nothing twice', async () => {
    await call(inboundBody('m1', 'STOP'))
    const again = await call(inboundBody('m1', 'STOP'))
    expect(again.status).toBe(200)
    expect(testSmsOutbox()).toHaveLength(1)
    expect(table('sms_inbound')).toHaveLength(1)
    expect(table('customer_sms_consent')).toHaveLength(1)
  })
  it('a plain "please stop texting me" is an opt-out and waits for the owner to see it', async () => {
    await call(inboundBody('m1', 'please stop texting me'))
    expect(table('customer_message_suppressions')).toHaveLength(1)
    expect(table('sms_inbound')[0]).toMatchObject({ kind: 'optout_phrase', status: 'needs_staff' })
  })
  it('"can you stop by at 3" is NOT an opt-out', async () => {
    await call(inboundBody('m1', 'can you stop by at 3?'))
    expect(table('customer_message_suppressions')).toHaveLength(0)
    expect(testSmsOutbox()).toHaveLength(0)
    expect(table('activities')).toHaveLength(1)
  })
  it('HELP is answered with the company’s phone and email; START lifts the opt-out and records a new OK', async () => {
    await call(inboundBody('m1', 'HELP'))
    expect(testSmsOutbox()[0].text).toContain('8505550150')
    await call(inboundBody('m2', 'STOP'))
    await call(inboundBody('m3', 'START'))
    expect(table('customer_message_suppressions')).toHaveLength(0)
    expect(table('customer_sms_consent').map((r) => r.status)).toEqual(['revoked', 'granted'])
    expect(testSmsOutbox().at(-1)?.text).toMatch(/subscribed again/)
  })
  it('the carrier answers itself (SMS_COMPLIANCE_AUTO_REPLY=false): we record, we do not reply', async () => {
    process.env.SMS_COMPLIANCE_AUTO_REPLY = 'false'
    await call(inboundBody('m1', 'STOP'))
    expect(table('customer_message_suppressions')).toHaveLength(1)
    expect(testSmsOutbox()).toHaveLength(0)
  })
  it('STOP from a number we cannot match still suppresses it, and does not create a customer', async () => {
    await call(inboundBody('m1', 'STOP', CO_A, '+18505550777'))
    expect(table('customer_message_suppressions')[0]).toMatchObject({ address: '+18505550777' })
    expect(table('customers')).toHaveLength(2)
    expect(table('sms_inbound')[0].status).toBe('handled')
  })
})

describe('switch off or number disconnected', () => {
  const off = () => {
    ;((db.tables.orgs as Row[])[0].settings as { features: Record<string, boolean> }).features.texting = false
  }
  it('STOP is still honored; nothing else is stored or posted', async () => {
    off()
    await call(inboundBody('m1', 'STOP'))
    expect(table('customer_message_suppressions')).toHaveLength(1)
    expect(table('customer_sms_consent')[0]).toMatchObject({ status: 'revoked' })
    expect(table('activities')).toHaveLength(0)
    await call(inboundBody('m2', 'hello there'))
    await call(inboundBody('m3', 'HELP'))
    expect(table('activities')).toHaveLength(0)
    expect(table('sms_inbound').map((r) => r.provider_message_id)).toEqual(['m1'])
  })
  it('a disconnected number behaves the same', async () => {
    ;(table('org_sms')[0] as Row).status = 'not_started'
    await call(inboundBody('m1', 'hello'))
    expect(table('sms_inbound')).toHaveLength(0)
    await call(inboundBody('m2', 'please stop texting me'))
    expect(table('customer_message_suppressions')).toHaveLength(1)
  })
})

describe('START', () => {
  it('from someone who never opted out is only answered: no new consent', async () => {
    await call(inboundBody('m1', 'START'))
    expect(table('customer_sms_consent')).toHaveLength(0)
  })
})

describe('ordinary texts', () => {
  it('unknown number: waits for staff, no customer is created, nothing is sent', async () => {
    await call(inboundBody('m1', 'Hi, do you do gutters?', CO_A, '+18505550777'))
    expect(table('sms_inbound')[0]).toMatchObject({ status: 'needs_staff' })
    expect(table('sms_inbound')[0].customer_id ?? null).toBeNull()
    expect(table('customers')).toHaveLength(2)
    expect(table('activities')).toHaveLength(0)
    expect(testSmsOutbox()).toHaveLength(0)
  })
  it('two customers share the number: goes to the one we last texted, else waits for staff', async () => {
    table('customers').push({ id: 'c2', org_id: ORG, name: 'Jane’s husband', phone: '850-555-0100', email: null, messages_off_at: null })
    await call(inboundBody('m1', 'which of us?'))
    expect(table('sms_inbound')[0]).toMatchObject({ status: 'needs_staff' })
    table('customer_messages').push({ id: 'x', org_id: ORG, channel: 'sms', to_address: CUST, status: 'sent', sent_at: '2026-11-10T00:00:00Z', customer_id: 'c2' })
    await call(inboundBody('m2', 'second one'))
    expect(table('sms_inbound').find((r) => r.provider_message_id === 'm2')).toMatchObject({ customer_id: 'c2' })
  })
  it('a photo is noted in the thread, not silently dropped', async () => {
    const body = JSON.stringify({ data: { event_type: 'message.received', payload: { id: 'mm', text: '', from: { phone_number: CUST }, to: [{ phone_number: CO_A }], media: [{}, {}] } } })
    await call(body)
    expect(String(table('activities')[0].body)).toContain('2 photos')
  })
  it('a customer’s text starts a conversation that allows a staff reply (inbound row stored with the company number)', async () => {
    await call(inboundBody('m1', 'when are you coming?'))
    expect(table('sms_inbound')[0]).toMatchObject({ from_e164: CUST, to_e164: CO_A, status: 'handled', kind: 'message' })
  })
  it('usage is counted once per carrier message', async () => {
    await call(inboundBody('m1', 'hello'))
    await call(inboundBody('m1', 'hello'))
    expect(table('sms_usage')).toHaveLength(1)
    expect(table('sms_usage')[0]).toMatchObject({ org_id: ORG, direction: 'in' })
  })
  it('a failure after the claim releases it, so the carrier’s retry does the work', async () => {
    const real = (db.client as unknown as { rpc: unknown }).rpc
    ;(db.client as { rpc: unknown }).rpc = () => ({ then: (r: (v: unknown) => void) => r({ data: null, error: { message: 'boom' } }) })
    const bad = await call(inboundBody('m1', 'hello'))
    expect(bad.status).toBe(500)
    expect(table('sms_inbound')).toHaveLength(0)
    ;(db.client as { rpc: unknown }).rpc = real
    expect((await call(inboundBody('m1', 'hello'))).status).toBe(200)
    expect(table('activities')).toHaveLength(1)
  })
})

describe('delivery receipts', () => {
  const receipt = (id: string, status: string, code?: string, from = CO_A) =>
    JSON.stringify({ data: { event_type: 'message.finalized', occurred_at: '2026-11-11T17:01:00Z', payload: { id, from: { phone_number: from }, to: [{ phone_number: CUST, status }], errors: code ? [{ code, title: 'x' }] : [], cost: { amount: '0.0075' }, parts: 1 } } })
  const sent = (over: Row = {}) => table('customer_messages').push({ id: 'cm1', org_id: ORG, channel: 'sms', provider_message_id: 'p1', to_address: CUST, customer_id: 'c1', status: 'sent', delivery_status: 'sent', ...over })

  it('delivered is recorded; a late "sent" does not undo it', async () => {
    sent()
    table('sms_usage').push({ org_id: ORG, direction: 'out', provider_message_id: 'p1', segments: 1, cost_micros: 1, kind: 'staff_reply' })
    await call(receipt('p1', 'delivered'))
    expect(table('customer_messages')[0]).toMatchObject({ delivery_status: 'delivered' })
    expect(table('sms_usage')[0]).toMatchObject({ provider_cost_micros: 7500 })
    await call(JSON.stringify({ data: { event_type: 'message.sent', payload: { id: 'p1', from: { phone_number: CO_A }, to: [{ phone_number: CUST, status: 'sent' }] } } }))
    expect(table('customer_messages')[0].delivery_status).toBe('delivered')
  })
  it('an invalid-number failure suppresses it; a carrier "blocked" is an opt-out with a revoke row', async () => {
    sent()
    await call(receipt('p1', 'delivery_failed', '40001'))
    expect(table('customer_message_suppressions')[0]).toMatchObject({ reason: 'bounced', address: CUST })
    expect(table('customer_messages')[0]).toMatchObject({ delivery_status: 'failed' })
    db = makeDb()
    sent()
    await call(receipt('p1', 'delivery_failed', '40300'))
    expect(table('customer_message_suppressions')[0]).toMatchObject({ reason: 'unsubscribed' })
    expect(table('customer_sms_consent')[0]).toMatchObject({ status: 'revoked' })
  })
  it('a receipt from another company’s number cannot touch this company’s message', async () => {
    sent()
    await call(receipt('p1', 'delivery_failed', '40001', CO_B))
    expect(table('customer_messages')[0].delivery_status).toBe('sent')
    expect(table('customer_message_suppressions')).toHaveLength(0)
  })
  it('a fresh receipt for a message not saved yet asks the carrier to retry; an old one is dropped', async () => {
    const fresh = JSON.stringify({ data: { event_type: 'message.finalized', occurred_at: new Date().toISOString(), payload: { id: 'nope', from: { phone_number: CO_A }, to: [{ phone_number: CUST, status: 'delivered' }] } } })
    expect((await call(fresh)).status).toBe(500)
    expect((await call(receipt('nope', 'delivered'))).status).toBe(200) // occurred 2026-11-11: long ago
  })
  it('"delivery unconfirmed" is not a failure and does not suppress', async () => {
    sent()
    await call(receipt('p1', 'delivery_unconfirmed', '40008'))
    expect(table('customer_messages')[0].delivery_status).toBe('delivery_unconfirmed')
    expect(table('customer_message_suppressions')).toHaveLength(0)
  })
})
