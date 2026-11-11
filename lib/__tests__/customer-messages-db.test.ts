/**
 * The automatic customer message sender end to end on a fake database: scheduling in the company's time zone across
 * DST, quiet hours, one message per key (idempotency, concurrent claims), stop conditions (moved / skipped visits,
 * signed quotes, paid invoices, reopened visits, autopay waiting for its result) and opt-outs (office flag,
 * unsubscribe, bounce, daily cap).
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const ORG = 'org-precision'
const OTHER = 'org-other'
process.env.DEPLOYMENT_ORG_ID = ORG
process.env.CUSTOMER_MESSAGE_LINK_SECRET = 'test-link-secret-0123456789'

type Sent = { to: string; subject: string; text: string; unsubscribe: string | null; from: { name: string; address: string }; messageId: string }
const sends: Sent[] = []
const attemptsSeen: Sent[] = []
let nextSend: () => { ok: true; providerId: string } | { ok: false; permanent: boolean; unknown?: boolean; error: string } = () => ({ ok: true, providerId: 'm' })

jest.mock('@/lib/customer-message-channels', () => {
  const actual = jest.requireActual('@/lib/customer-message-channels')
  const fake = {
    channel: 'email',
    available: () => true,
    addressFor: actual.emailChannel.addressFor,
    send: async (to: string, m: { subject: string; text: string }, o: { unsubscribeUrl: string | null; from: { name: string; address: string }; messageId: string }) => {
      const out = nextSend()
      const rec = { to, subject: m.subject, text: m.text, unsubscribe: o.unsubscribeUrl, from: o.from, messageId: o.messageId }
      attemptsSeen.push(rec)
      if (out.ok) sends.push(rec)
      return out
    },
  }
  return { ...actual, channelSender: () => fake }
})
jest.mock('@/lib/company-links', () => ({ tryOrgAppUrl: jest.fn(async () => 'https://precision.example.com') }))
jest.mock('@/lib/files/files-object', () => ({
  orgLogoHref: () => null,
  signFilesObject: async (_a: unknown, p: string) => `https://storage.test/${p}`,
}))
const online = { ready: false, settings: { autopay: false } }
jest.mock('@/lib/online-payments/accounts', () => ({ loadOnlinePayments: jest.fn(async () => online) }))
jest.mock('@/lib/online-payments/links', () => ({ createPaymentLink: jest.fn(async () => ({ id: 'l1', url: 'https://precision.example.com/pay/tok', expiresAt: '' })) }))
let card: { autopay: boolean } | null = null
jest.mock('@/lib/online-payments/cards', () => ({ loadCardOnFile: jest.fn(async () => card) }))

import {
  deliver,
  linkTokenFor,
  loadCustomerMessagesBlockedQueue,
  findMessageByToken,
  loadSendContext,
  messagePhotos,
  notifyVisitOnTheWay,
  queueVisitDone,
  runCustomerMessagesForOrg,
  setCustomerMessages,
  unsubscribeMessage,
  type MessageRow,
} from '@/lib/customer-messages-db'

const ALL_ON = { visitReminder: true, onTheWay: true, visitDone: true, quoteFollowUp: true, invoiceReminder: true }

function org(id: string, over: Record<string, unknown> = {}, messages: Record<string, unknown> = ALL_ON, features: Record<string, unknown> = { customerMessages: true }) {
  return {
    id,
    name: 'Precision Maintenance',
    address: '12 Main St\nCrawfordville, FL 32327',
    phone: '8505550100',
    email: 'office@precision.test',
    timezone: 'America/New_York',
    logo_url: null,
    settings: { features: { ...features }, customerMessages: { ...messages }, brand: { website: 'precision.test' } },
    ...over,
  }
}

function visit(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    org_id: ORG,
    work_order_type: 'service_visit',
    status: 'scheduled',
    scheduled_date: '2026-11-12',
    service_planned_date: '2026-11-12',
    customer_id: 'c1',
    property_id: 'p1',
    service_plan_id: 'plan1',
    visit_step: 'service',
    address: null,
    title: 'Weekly mow',
    completed_at: null,
    ...over,
  }
}

type Row = Record<string, unknown>
/** JS mirror of SQL customer_message_claim (migration 202611120050) — the real one also takes a per-address advisory lock. */
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

function seed(over: Record<string, unknown[]> = {}) {
  return createFakeDb(
    {
      orgs: [org(ORG)],
      users: [],
      customers: [
        { id: 'c1', org_id: ORG, name: 'Jane Smith', email: 'Jane@Example.com', messages_off_at: null, messages_off_by: null },
        { id: 'c2', org_id: ORG, name: 'Bob Lee', email: 'bob@example.com', messages_off_at: null, messages_off_by: null },
      ],
      properties: [
        { id: 'p1', org_id: ORG, address_text: '1 Oak St' },
        { id: 'p2', org_id: ORG, address_text: '9 Pine Rd' },
      ],
      service_plans: [{ id: 'plan1', org_id: ORG, name: 'Weekly lawn care', steps: [] }],
      work_orders: [],
      customer_messages: [],
      customer_message_suppressions: [],
      photos: [],
      proposals: [],
      opportunities: [],
      order_form_contracts: [],
      job_invoices: [],
      job_invoice_items: [],
      invoice_payments: [],
      online_payments: [],
      production_jobs: [],
      ...over,
    },
    { unique: { customer_messages: [['org_id', 'message_key']], customer_message_suppressions: [['org_id', 'channel', 'address']] }, rpc: { customer_message_claim: fakeClaim } }
  )
}

// 9:30 AM in New York on Wed 2026-11-11 (EST).
const MORNING = new Date('2026-11-11T14:30:00Z')

beforeEach(() => {
  sends.length = 0
  attemptsSeen.length = 0
  nextSend = () => ({ ok: true, providerId: 'm' })
  online.ready = false
  online.settings.autopay = false
  card = null
})

const rows = (db: ReturnType<typeof seed>) => db.tables.customer_messages as unknown as MessageRow[]
const admin = (db: ReturnType<typeof seed>) => db.client as never

describe('who it runs for', () => {
  it('switch off, or every message off (ARX today: nothing stored) → nothing is read or sent', async () => {
    const off = seed({ orgs: [org(ORG, {}, ALL_ON, {})], work_orders: [visit('v1')] })
    expect(await runCustomerMessagesForOrg(admin(off), ORG, MORNING)).toEqual({ orgId: ORG, skipped: 'feature_off' })
    const none = seed({ orgs: [org(ORG, {}, {})], work_orders: [visit('v1')] })
    expect(await runCustomerMessagesForOrg(admin(none), ORG, MORNING)).toEqual({ orgId: ORG, skipped: 'all_off' })
    expect(sends).toHaveLength(0)
  })
  it('another company’s visits are never read', async () => {
    const db = seed({ work_orders: [visit('v1', { org_id: OTHER })] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends).toHaveLength(0)
  })
})

describe('visit reminders', () => {
  it('one email per customer per day for several visits / properties; the second run sends nothing', async () => {
    const db = seed({ work_orders: [visit('v1'), visit('v2', { property_id: 'p2' }), visit('v3', { customer_id: 'c2' })] })
    const r = await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(r.stats?.sent).toBe(2)
    const jane = sends.find((s) => s.to === 'jane@example.com')!
    expect(jane.subject).toBe('Reminder: we’ll see you tomorrow')
    expect(jane.text).toContain('1 Oak St')
    expect(jane.text).toContain('9 Pine Rd')
    expect(jane.text).toContain('Weekly lawn care')
    expect(jane.unsubscribe).toMatch(/^https:\/\/precision\.example\.com\/m\/[A-Za-z0-9_-]{43}\?stop=1$/)
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 15 * 60_000))
    expect(sends).toHaveLength(2)
    expect(rows(db).map((m) => m.message_key).sort()).toEqual(['visit_reminder:email:c1:2026-11-12', 'visit_reminder:email:c2:2026-11-12'])
  })
  it('skipped / done / cancelled visits get none; a visit two days out waits for its day', async () => {
    const db = seed({ work_orders: [visit('v1', { status: 'skipped' }), visit('v2', { customer_id: 'c2', scheduled_date: '2026-11-13' })] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends).toHaveLength(0)
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-12T14:30:00Z'))
    expect(sends.map((s) => s.to)).toEqual(['bob@example.com'])
  })
  it('a visit moved after its reminder went out gets a reminder for the new day; one skipped before sending is cancelled', async () => {
    const db = seed({ work_orders: [visit('v1')] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends).toHaveLength(1)
    // Rain on Thursday: moved to Friday. Thursday (the new reminder day) the customer hears about Friday.
    ;(db.tables.work_orders[0] as Record<string, unknown>).scheduled_date = '2026-11-13'
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-12T14:30:00Z'))
    expect(sends).toHaveLength(2)
    expect(sends[1].subject).toBe('Reminder: we’ll see you tomorrow')
    expect(rows(db).map((m) => m.message_key)).toContain('visit_reminder:email:c1:2026-11-13')

    // A queued reminder whose visit is skipped before it goes: cancelled, not sent.
    const db2 = seed({ work_orders: [visit('v9')] })
    const loaded = await loadSendContext(admin(db2), ORG, MORNING)
    if (!loaded.ok) throw new Error(loaded.reason)
    const { scanVisitReminders } = await import('@/lib/customer-messages-db')
    await scanVisitReminders(loaded.ctx)
    ;(db2.tables.work_orders[0] as Record<string, unknown>).status = 'skipped'
    expect(await deliver(loaded.ctx, rows(db2)[0])).toBe('cancelled')
    expect(rows(db2)[0]).toMatchObject({ status: 'cancelled', skip_reason: 'no_visits_that_day' })
    expect(sends).toHaveLength(2)
  })
  it('a visit moved to today late in the day gets nothing; moved this morning it gets a "today" reminder', async () => {
    const late = seed({ work_orders: [visit('v1', { scheduled_date: '2026-11-11' })] })
    await runCustomerMessagesForOrg(admin(late), ORG, new Date('2026-11-11T17:00:00Z')) // noon
    expect(sends).toHaveLength(0)
    await runCustomerMessagesForOrg(admin(late), ORG, MORNING) // 9:30
    expect(sends[0].subject).toBe('Reminder: we’ll see you today')
  })
  it('lead days: 3 days before', async () => {
    const db = seed({ orgs: [org(ORG, {}, { visitReminder: true, visitReminderDays: 3 })], work_orders: [visit('v1', { scheduled_date: '2026-11-14' })] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends[0].subject).toBe('Reminder: we’ll see you Saturday, November 14')
  })
})

describe('time zone, quiet hours, DST', () => {
  it('quiet hours: nothing at 9 PM; sent once the morning comes', async () => {
    const db = seed({ work_orders: [visit('v1')] })
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-12T02:00:00Z')) // 9 PM Wed
    expect(sends).toHaveLength(0)
    expect(rows(db)).toHaveLength(0)
    // Thursday 8:15 AM is the visit day itself: the morning "today" reminder.
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-12T13:15:00Z'))
    expect(sends[0].subject).toBe('Reminder: we’ll see you today')
  })
  it('fall back (Nov 1): 12:30 UTC is 8:30 EDT on Oct 31 (sends) but 7:30 EST on Nov 1 (quiet)', async () => {
    const a = seed({ work_orders: [visit('v1', { scheduled_date: '2026-11-01' })] })
    await runCustomerMessagesForOrg(admin(a), ORG, new Date('2026-10-31T12:30:00Z'))
    expect(sends).toHaveLength(1)
    const b = seed({ work_orders: [visit('v1', { scheduled_date: '2026-11-02' })] })
    await runCustomerMessagesForOrg(admin(b), ORG, new Date('2026-11-01T12:30:00Z'))
    expect(sends).toHaveLength(1)
    await runCustomerMessagesForOrg(admin(b), ORG, new Date('2026-11-01T13:30:00Z')) // 8:30 EST
    expect(sends).toHaveLength(2)
  })
  it('spring forward (Mar 8): 12:30 UTC is 7:30 EST on Mar 7 (quiet) but 8:30 EDT on Mar 8 (sends)', async () => {
    const a = seed({ work_orders: [visit('v1', { scheduled_date: '2026-03-08' })] })
    await runCustomerMessagesForOrg(admin(a), ORG, new Date('2026-03-07T12:30:00Z'))
    expect(sends).toHaveLength(0)
    const b = seed({ work_orders: [visit('v1', { scheduled_date: '2026-03-09' })] })
    await runCustomerMessagesForOrg(admin(b), ORG, new Date('2026-03-08T12:30:00Z'))
    expect(sends).toHaveLength(1)
  })
  it('the company’s own zone decides the day: 7 PM Pacific on Nov 11 reminds about Nov 12; New York at that instant is quiet', async () => {
    const now = new Date('2026-11-12T03:00:00Z')
    const west = seed({ orgs: [org(ORG, { timezone: 'America/Los_Angeles' })], work_orders: [visit('v1')] })
    await runCustomerMessagesForOrg(admin(west), ORG, now)
    expect(sends.map((s) => s.subject)).toEqual(['Reminder: we’ll see you tomorrow'])
    const east = seed({ work_orders: [visit('v1')] })
    await runCustomerMessagesForOrg(admin(east), ORG, now)
    expect(sends).toHaveLength(1)
  })
})

describe('idempotency', () => {
  it('two runs claiming the same row: exactly one send', async () => {
    const db = seed({ work_orders: [visit('v1')] })
    const a = await loadSendContext(admin(db), ORG, MORNING)
    const b = await loadSendContext(admin(db), ORG, MORNING)
    if (!a.ok || !b.ok) throw new Error('context')
    const { scanVisitReminders } = await import('@/lib/customer-messages-db')
    await scanVisitReminders(a.ctx)
    await scanVisitReminders(b.ctx) // same key: no second row
    expect(rows(db)).toHaveLength(1)
    const row = { ...rows(db)[0] }
    const [r1, r2] = [await deliver(a.ctx, row), await deliver(b.ctx, row)]
    expect([r1, r2]).toEqual(['sent', 'not_claimed'])
    expect(sends).toHaveLength(1)
  })
  it('a row stuck "sending" (died mid-send) is closed as failed and never retried', async () => {
    const db = seed({
      customer_messages: [
        { id: 'm1', org_id: ORG, message_key: 'k', kind: 'visit_reminder', channel: 'email', status: 'sending', customer_id: 'c1', refs: { customerId: 'c1', day: '2026-11-12' }, attempts: 1, claimed_at: '2026-11-11T13:00:00Z', send_after: '2026-11-11T13:00:00Z', created_at: '2026-11-11T13:00:00Z' },
      ],
      work_orders: [visit('v1', { customer_id: 'c2' })],
    })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(rows(db).find((m) => m.id === 'm1')).toMatchObject({ status: 'failed', attempts: 3 })
    expect(sends.map((s) => s.to)).toEqual(['bob@example.com'])
  })
  it('a temporary SMTP failure is retried later (same key), at most 3 tries', async () => {
    const db = seed({ work_orders: [visit('v1')] })
    nextSend = () => ({ ok: false, permanent: false, error: '421 try later' })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(rows(db)[0]).toMatchObject({ status: 'failed', attempts: 1 })
    nextSend = () => ({ ok: true, providerId: 'm' })
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 15 * 60_000)) // not yet (30 min backoff)
    expect(sends).toHaveLength(0)
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 31 * 60_000))
    expect(sends).toHaveLength(1)
    expect(rows(db)).toHaveLength(1)
    expect(rows(db)[0]).toMatchObject({ status: 'sent', attempts: 2 })
  })
})

describe('opt-outs', () => {
  it('office "don’t email": skipped, logged with the reason', async () => {
    const db = seed({ work_orders: [visit('v1')] })
    expect(await setCustomerMessages(admin(db), ORG, 'c1', false, 'u1')).toEqual({ ok: true })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends).toHaveLength(0)
    expect(rows(db)[0]).toMatchObject({ status: 'skipped', skip_reason: 'customer_opted_out' })
  })
  it('unsubscribe link: address suppressed + customer marked; turning back on needs the customer’s say-so', async () => {
    const db = seed({ work_orders: [visit('v1'), visit('v2', { scheduled_date: '2026-11-13' })] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    const sent = rows(db)[0]
    const token = sends[0].unsubscribe!.match(/\/m\/([^?]+)/)![1]
    const found = await findMessageByToken(admin(db), token)
    expect(found?.id).toBe(sent.id)
    expect(await findMessageByToken(admin(db), 'x'.repeat(43))).toBeNull()
    await unsubscribeMessage(admin(db), found!)
    await unsubscribeMessage(admin(db), found!) // idempotent
    expect(db.tables.customer_message_suppressions).toHaveLength(1)
    expect(db.tables.customer_message_suppressions[0]).toMatchObject({ address: 'jane@example.com', reason: 'unsubscribed' })
    expect(db.tables.customers[0].messages_off_by).toBeNull()
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-12T14:30:00Z'))
    expect(sends).toHaveLength(1)
    expect(await setCustomerMessages(admin(db), ORG, 'c1', true, 'u1')).toMatchObject({ ok: false, status: 409 })
    expect(await setCustomerMessages(admin(db), ORG, 'c1', true, 'u1', true)).toEqual({ ok: true })
    expect(db.tables.customer_message_suppressions).toHaveLength(0)
    expect(db.tables.customers[0].messages_off_at).toBeNull()
  })
  it('a hard bounce suppresses the address; a customer with no email is skipped', async () => {
    const db = seed({ work_orders: [visit('v1'), visit('v2', { customer_id: 'c2' })] })
    ;(db.tables.customers[1] as Record<string, unknown>).email = 'n/a'
    nextSend = () => ({ ok: false, permanent: true, error: '550 no such user' })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    const byCustomer = Object.fromEntries(rows(db).map((m) => [m.customer_id, m]))
    expect(byCustomer.c1).toMatchObject({ status: 'skipped', skip_reason: 'bounced' })
    expect(byCustomer.c2).toMatchObject({ status: 'skipped', skip_reason: 'no_address' })
    expect(db.tables.customer_message_suppressions[0]).toMatchObject({ address: 'jane@example.com', reason: 'bounced' })
  })
  it('no more than 4 automatic emails to one address in 24 hours', async () => {
    const recent = Array.from({ length: 4 }, (_, i) => ({
      id: `old${i}`, org_id: ORG, message_key: `old${i}`, kind: 'visit_done', channel: 'email', status: 'sent', customer_id: 'c1', to_address: 'jane@example.com', refs: {}, attempts: 1, send_after: '2026-11-11T10:00:00Z', sent_at: '2026-11-11T10:00:00Z', created_at: '2026-11-11T10:00:00Z',
    }))
    const db = seed({ customer_messages: recent, work_orders: [visit('v1')] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends).toHaveLength(0)
    expect(rows(db).find((m) => m.kind === 'visit_reminder')).toMatchObject({ status: 'skipped', skip_reason: 'daily_limit' })
  })
})

describe('on the way / done', () => {
  it('on the way: today’s open visit only, once per day, even in quiet hours', async () => {
    const db = seed({ work_orders: [visit('v1', { scheduled_date: '2026-11-11' }), visit('v2', { scheduled_date: '2026-11-12' })] })
    const early = new Date('2026-11-11T12:15:00Z') // 7:15 AM — quiet until 8
    expect(await notifyVisitOnTheWay(admin(db), ORG, 'v1', early)).toEqual({ status: 'sent' })
    expect(await notifyVisitOnTheWay(admin(db), ORG, 'v1', early)).toEqual({ status: 'already' })
    expect(await notifyVisitOnTheWay(admin(db), ORG, 'v2', early)).toEqual({ status: 'not_today' })
    expect(sends.map((s) => s.subject)).toEqual(['We’re on our way'])
  })
  it('done: queued 15 minutes out, cancelled if reopened, photos link when there are photos; catch-up marking sends nothing', async () => {
    const db = seed({
      work_orders: [visit('v1', { scheduled_date: '2026-11-11', status: 'completed' }), visit('v2', { scheduled_date: '2026-11-10', status: 'completed', customer_id: 'c2' })],
      photos: [{ id: 'ph1', org_id: ORG, work_order_id: 'v1', storage_path: 'org/x/visit/a.jpg', mime_type: 'image/jpeg', deleted_at: null, created_at: '2026-11-11T14:00:00Z' }],
    })
    expect(await queueVisitDone(admin(db), ORG, 'v1', MORNING)).toEqual({ status: 'queued' })
    expect(await queueVisitDone(admin(db), ORG, 'v1', MORNING)).toEqual({ status: 'already' })
    expect(await queueVisitDone(admin(db), ORG, 'v2', MORNING)).toEqual({ status: 'not_today' })
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 5 * 60_000))
    expect(sends.filter((s) => s.subject === 'Your visit is done')).toHaveLength(0)
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 16 * 60_000))
    const done = sends.find((s) => s.subject === 'Your visit is done')!
    expect(done.text).toMatch(/See the photos: https:\/\/precision\.example\.com\/m\//)
    const row = rows(db).find((m) => m.kind === 'visit_done')!
    expect(await messagePhotos(admin(db), row, new Date(MORNING.getTime() + 20 * 60_000))).toEqual(['https://storage.test/org/x/visit/a.jpg'])
    expect(await messagePhotos(admin(db), row, new Date(MORNING.getTime() + 91 * 86_400_000))).toEqual([])

    const db2 = seed({ work_orders: [visit('v1', { scheduled_date: '2026-11-11', status: 'completed' })] })
    await queueVisitDone(admin(db2), ORG, 'v1', MORNING)
    ;(db2.tables.work_orders[0] as Record<string, unknown>).status = 'scheduled' // reopened
    await runCustomerMessagesForOrg(admin(db2), ORG, new Date(MORNING.getTime() + 16 * 60_000))
    expect(rows(db2).find((m) => m.kind === 'visit_done')).toMatchObject({ status: 'cancelled', skip_reason: 'reopened' })
  })
  it('done before the migration: the visit stands, no email, no throw', async () => {
    const db = seed({ work_orders: [visit('v1', { scheduled_date: '2026-11-11', status: 'completed' })] })
    const client = db.client as unknown as { from: (t: string) => unknown }
    const real = client.from.bind(client)
    client.from = (t: string) => {
      if (t !== 'customer_messages') return real(t)
      const err = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
      const chain: Record<string, unknown> = {}
      for (const k of ['insert', 'select', 'single', 'eq', 'limit']) chain[k] = () => chain
      ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(err).then(res)
      return chain
    }
    expect(await queueVisitDone(admin(db), ORG, 'v1', MORNING)).toEqual({ status: 'not_ready' })
  })
})

describe('quote follow-ups', () => {
  const quote = (over: Record<string, unknown> = {}) => ({
    id: 'q1', org_id: ORG, status: 'sent', customer_name: 'Jane Smith', customer_email: 'jane@example.com', proposal_number: 1042, total: 1850, opportunity_id: 'o1', sent_at: '2026-11-08T15:00:00Z', pdf_generated_at: null, created_at: '2026-11-08T15:00:00Z', created_by: 'u1', ...over,
  })
  it('day 3 sends (with the waiting signing link); signed or declined since → cancelled; won deal → none', async () => {
    const db = seed({
      proposals: [quote()],
      opportunities: [{ id: 'o1', org_id: ORG, status: 'open', customer_id: 'c1' }],
      order_form_contracts: [{ id: 'k1', org_id: ORG, proposal_id: 'q1', status: 'pending_customer', signing_token: 'sig-123', created_at: '2026-11-08T16:00:00Z' }],
    })
    // The company's own word for a quote (industry profile): lawn & landscape says "Quote", roofing "Proposal".
    ;((db.tables.orgs[0] as { settings: Record<string, unknown> }).settings).profile = { id: 'lawn_landscape', version: 3 }
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends[0].subject).toBe('Following up on your quote #1042')
    expect(sends[0].text).toContain('https://precision.example.com/contracts/sign/sig-123')
    // Day 4: still inside step 3's window → nothing new.
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-12T14:30:00Z'))
    expect(sends).toHaveLength(1)
    // Day 7 step queued, then the customer signs before it goes.
    const loaded = await loadSendContext(admin(db), ORG, new Date('2026-11-15T14:30:00Z'))
    if (!loaded.ok) throw new Error(loaded.reason)
    const { scanQuoteFollowUps } = await import('@/lib/customer-messages-db')
    await scanQuoteFollowUps(loaded.ctx)
    ;(db.tables.proposals[0] as Record<string, unknown>).status = 'accepted'
    expect(await deliver(loaded.ctx, rows(db).find((m) => m.message_key.endsWith(':7'))!)).toBe('cancelled')

    const won = seed({ proposals: [quote()], opportunities: [{ id: 'o1', org_id: ORG, status: 'won', customer_id: 'c1' }] })
    await runCustomerMessagesForOrg(admin(won), ORG, MORNING)
    expect(sends).toHaveLength(1)
  })
  it('a quote sent 60 days ago when the switch is turned on gets nothing', async () => {
    const db = seed({ proposals: [quote({ sent_at: '2026-09-10T15:00:00Z' })], opportunities: [{ id: 'o1', org_id: ORG, status: 'open', customer_id: 'c1' }] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends).toHaveLength(0)
  })
})

describe('invoice reminders', () => {
  const inv = (over: Record<string, unknown> = {}) => ({
    id: 'i1', org_id: ORG, job_id: null, customer_id: 'c1', property_id: null, invoice_number: 'INV-26-00042', invoice_kind: 'service', status: 'sent', issued_at: '2026-11-01', due_at: '2026-11-04', sent_at: '2026-11-01T15:00:00Z', subtotal_cents: 18500, total_cents: 18500, tax_lines: null, paid_outside_cents: null, ...over,
  })
  it('7 days overdue: reminder with the balance; paid since → cancelled', async () => {
    const db = seed({ job_invoices: [inv()], job_invoice_items: [{ id: 'it1', invoice_id: 'i1', description: 'Lawn', qty: 1, unit_price_cents: 18500, line_total_cents: 18500, sort_order: 0 }] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends[0].subject).toBe('Past due: invoice INV-26-00042')
    expect(sends[0].text).toContain('$185.00')
    expect(sends[0].text).not.toContain('/pay/')

    const paid = seed({ job_invoices: [inv()], invoice_payments: [{ id: 'ap1', invoice_id: 'i1', applied_cents: 18500 }] })
    await runCustomerMessagesForOrg(admin(paid), ORG, MORNING)
    expect(rows(paid)[0]).toMatchObject({ status: 'cancelled', skip_reason: 'paid' })
    const voided = seed({ job_invoices: [inv({ status: 'void' })] })
    await runCustomerMessagesForOrg(admin(voided), ORG, MORNING)
    expect(rows(voided)).toHaveLength(0)
  })
  it('online payments: a pay link; autopay customers wait for the charge result, then hear', async () => {
    online.ready = true
    const db = seed({ job_invoices: [inv()], online_payments: [{ id: 'op1', org_id: ORG, invoice_id: 'i1', kind: 'autopay', status: 'processing' }] })
    online.settings.autopay = true
    card = { autopay: true }
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends).toHaveLength(0)
    expect(rows(db)[0]).toMatchObject({ status: 'queued', attempts: 0, last_error: 'waiting_for_automatic_payment' })
    ;(db.tables.online_payments[0] as Record<string, unknown>).status = 'failed'
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 7 * 3_600_000))
    expect(sends).toHaveLength(1)
    expect(sends[0].text).toContain('https://precision.example.com/pay/tok')
  })
})

describe('review fixes', () => {
  it('sent from the company’s own name and email, with a stable Message-ID', async () => {
    const db = seed({ work_orders: [visit('v1')] })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(sends[0].from).toEqual({ name: 'Precision Maintenance', address: 'office@precision.test' })
    expect(sends[0].messageId).toBe(`<cm-${rows(db)[0].id}@precision.example.com>`)
  })
  it('missing postal address / email / name: nothing sent, rows blocked, owners see the fix on Today; sent once fixed (if still in time)', async () => {
    const db = seed({ orgs: [org(ORG, { address: '  ', email: null })], work_orders: [visit('v1')] })
    const r = await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(r.stats?.blocked).toBe(1)
    expect(sends).toHaveLength(0)
    expect(rows(db)[0]).toMatchObject({ status: 'blocked', skip_reason: 'missing_company_email' })
    const q = await loadCustomerMessagesBlockedQueue(admin(db), ORG)
    expect(q).toMatchObject({ id: 'customer-messages-blocked', title: 'Customer emails are stopped', count: 1 })
    expect(q!.items.map((i) => i.id)).toEqual(['missing_company_email', 'missing_company_address'])
    // On-the-way taps are blocked too (never sent under another identity).
    const today = seed({ orgs: [org(ORG, { address: '' })], work_orders: [visit('v9', { scheduled_date: '2026-11-11' })] })
    expect(await notifyVisitOnTheWay(admin(today), ORG, 'v9', MORNING)).toEqual({ status: 'blocked' })
    // Fixed 2 hours later: the parked reminder goes out.
    Object.assign(db.tables.orgs[0], { address: '12 Main St', email: 'office@precision.test' })
    expect(await loadCustomerMessagesBlockedQueue(admin(db), ORG)).toBeNull()
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 2 * 3_600_000))
    expect(sends).toHaveLength(1)
    expect(rows(db)[0].status).toBe('sent')
  })
  it('never falls back to another company’s identity, even on an unfenced copy', async () => {
    const saved = process.env.DEPLOYMENT_ORG_ID
    delete process.env.DEPLOYMENT_ORG_ID
    try {
      const db = seed({ orgs: [org(ORG, { name: '', email: '', address: '', phone: '' })], work_orders: [visit('v1')] })
      await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
      expect(sends).toHaveLength(0)
      expect(rows(db)[0]).toMatchObject({ status: 'blocked', skip_reason: 'missing_company_name' })
    } finally {
      process.env.DEPLOYMENT_ORG_ID = saved
    }
  })
  it('a message turned off after it was queued is cancelled, not sent (every kind)', async () => {
    const db = seed({ work_orders: [visit('v1')], job_invoices: [] })
    const loaded = await loadSendContext(admin(db), ORG, MORNING)
    if (!loaded.ok) throw new Error(loaded.reason)
    const { scanVisitReminders } = await import('@/lib/customer-messages-db')
    await scanVisitReminders(loaded.ctx)
    ;((db.tables.orgs[0] as { settings: Record<string, unknown> }).settings.customerMessages as Record<string, unknown>).visitReminder = false
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    expect(rows(db)[0]).toMatchObject({ status: 'cancelled', skip_reason: 'turned_off' })
    expect(sends).toHaveLength(0)
  })
  it('a queued quote / invoice step past its late window is skipped, not sent', async () => {
    const db = seed({
      proposals: [{ id: 'q1', org_id: ORG, status: 'sent', customer_name: 'Jane', customer_email: 'jane@example.com', proposal_number: 1, total: 10, opportunity_id: null, sent_at: '2026-11-08T15:00:00Z', pdf_generated_at: null, created_at: '2026-11-08T15:00:00Z' }],
    })
    const loaded = await loadSendContext(admin(db), ORG, MORNING)
    if (!loaded.ok) throw new Error(loaded.reason)
    const { scanQuoteFollowUps } = await import('@/lib/customer-messages-db')
    await scanQuoteFollowUps(loaded.ctx)
    // An outage: the run comes back 4 days later (step 3 window was days 3–5).
    await runCustomerMessagesForOrg(admin(db), ORG, new Date('2026-11-14T14:30:00Z'))
    expect(rows(db).find((m) => m.message_key.endsWith(':3'))).toMatchObject({ status: 'skipped', skip_reason: 'too_late' })
    expect(sends).toHaveLength(0)
  })
  it('daily cap: counted by the address recorded at claim, sending + retry rows included; two parallel sends can’t both slip under it', async () => {
    const prior = (i: number, status: string, attempts = 1) => ({
      id: `old${i}`, org_id: ORG, message_key: `old${i}`, kind: 'visit_done', channel: 'email', status, customer_id: 'c1', to_address: 'jane@example.com', refs: {}, attempts, send_after: '2026-11-11T10:00:00Z', claimed_at: '2026-11-11T10:00:00Z', created_at: '2026-11-11T10:00:00Z',
    })
    const db = seed({
      customer_messages: [prior(1, 'sent'), prior(2, 'sending'), prior(3, 'failed', 1)],
      work_orders: [visit('v1', { scheduled_date: '2026-11-11' }), visit('v2', { scheduled_date: '2026-11-11', property_id: 'p2' })],
    })
    const a = await notifyVisitOnTheWay(admin(db), ORG, 'v1', MORNING)
    const b = await notifyVisitOnTheWay(admin(db), ORG, 'v2', MORNING)
    expect([a.status, b.status].sort()).toEqual(['sent', 'skipped'])
    expect(sends).toHaveLength(1)
    expect(rows(db).filter((m) => m.skip_reason === 'daily_limit')).toHaveLength(1)
  })
  it('SMTP with no answer (timeout): not retried soon; the retry carries the same Message-ID and the same links', async () => {
    const db = seed({ work_orders: [visit('v1')] })
    nextSend = () => ({ ok: false, permanent: false, unknown: true, error: 'Timeout' })
    await runCustomerMessagesForOrg(admin(db), ORG, MORNING)
    const row = rows(db)[0]
    expect(row).toMatchObject({ status: 'failed', attempts: 1 })
    expect(row.last_error).toMatch(/^unknown \(may have been sent\)/)
    expect(Date.parse(row.send_after) - MORNING.getTime()).toBe(6 * 3_600_000)
    nextSend = () => ({ ok: true, providerId: 'm' })
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 60 * 60_000))
    expect(sends).toHaveLength(0)
    // Still the reminder's day-before window at 3:30 PM.
    await runCustomerMessagesForOrg(admin(db), ORG, new Date(MORNING.getTime() + 6 * 3_600_000))
    expect(sends).toHaveLength(1)
    expect(attemptsSeen[0].messageId).toBe(attemptsSeen[1].messageId)
    expect(attemptsSeen[0].unsubscribe).toBe(attemptsSeen[1].unsubscribe)
    expect(attemptsSeen[1].unsubscribe).toContain(linkTokenFor(row.id))
  })
})
