/** @jest-environment node */
/** The untouched-lead rule, the Today queue (same loader as the morning email) and the once-per-lead reminder. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { isLeadUntouched, leadClockStart, listUntouchedLeads, loadLeadsWaitingQueue, runLeadReminderForOrg } from '@/lib/leads-waiting'
import { loadOwnerExceptions } from '@/lib/today'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-11-20T12:00:00Z')
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const lead = (id: string, over: Record<string, unknown> = {}) => ({ id, org_id: ORG, channel: 'inbound', status: 'new', homeowner_name: 'Pat Lee', source: 'Website', service_requested: 'Mulch', owner_user_id: 'u1', created_at: ago(30), ownership_reassigned_at: null, ...over })
const ON = { leadIntake: { reminderEnabled: true, reminderHours: 24 } }

const make = (leads: Array<Record<string, unknown>>, activities: Array<Record<string, unknown>> = [], settings: Record<string, unknown> = ON) =>
  createFakeDb(
    {
      orgs: [{ id: ORG, settings }],
      users: [{ id: 'u1', org_id: ORG, active: true, email: 'u1@x.test' }, { id: 'adm', org_id: ORG, active: true, role: 'admin', email: 'adm@x.test', created_at: '2026-01-01' }],
      leads,
      activities,
    },
    { unique: { notifications: [['type', 'link_url']] } }
  )
const ids = (r: { leads: Array<{ id: string }> }) => r.leads.map((l) => l.id)

describe('the rule', () => {
  test('N hours since it arrived, no contact', () => {
    expect(isLeadUntouched({ created_at: ago(24), ownership_reassigned_at: null }, false, 24, NOW)).toBe(true)
    expect(isLeadUntouched({ created_at: ago(23), ownership_reassigned_at: null }, false, 24, NOW)).toBe(false)
    expect(isLeadUntouched({ created_at: ago(99), ownership_reassigned_at: null }, true, 24, NOW)).toBe(false)
  })
  test('a hand-over to a new owner restarts the clock', () => {
    const l = { created_at: ago(100), ownership_reassigned_at: ago(2) }
    expect(leadClockStart(l).toISOString()).toBe(ago(2))
    expect(isLeadUntouched(l, false, 24, NOW)).toBe(false)
  })
})

describe('listUntouchedLeads', () => {
  test('inbound, still new, past N, no call/text/email/visit logged — this company only', async () => {
    const db = make(
      [
        lead('old'), lead('fresh', { created_at: ago(3) }),
        lead('called'), lead('noted'), lead('moved', { status: 'contacted' }),
        lead('canvass', { channel: 'outbound' }), lead('other', { org_id: OTHER }), lead('ancient', { created_at: ago(24 * 40) }),
        lead('deletedcall'),
      ],
      [
        { id: 'a1', org_id: ORG, lead_id: 'called', type: 'call', deleted_at: null },
        { id: 'a2', org_id: ORG, lead_id: 'noted', type: 'note', deleted_at: null },
        { id: 'a3', org_id: ORG, lead_id: 'deletedcall', type: 'call', deleted_at: ago(1) },
      ]
    )
    expect(ids(await listUntouchedLeads(db.client as never, ORG, 24, NOW)).sort()).toEqual(['deletedcall', 'noted', 'old'])
  })
  test('one person\'s leads only', async () => {
    const db = make([lead('mine'), lead('theirs', { owner_user_id: 'u2' })])
    expect(ids(await listUntouchedLeads(db.client as never, ORG, 24, NOW, { ownerUserId: 'u1' }))).toEqual(['mine'])
  })
})

describe('Today queue', () => {
  test('off until the company turns it on: ARX-style settings change nothing', async () => {
    const db = make([lead('old')], [], {})
    const q = await loadLeadsWaitingQueue(db.client as never, ORG, NOW)
    expect(q.count).toBe(0)
    expect(await loadOwnerExceptions(db.client as never, ORG, NOW)).toEqual([])
  })
  test('owner exceptions (so the Today screen and the morning email) carry it; email rows hold no name, phone or address', async () => {
    const db = make([lead('old', { homeowner_name: 'Pat Lee', address_text: '1 Main St', phone: '850-555-0100' })])
    const queues = await loadOwnerExceptions(db.client as never, ORG, NOW, { money: false })
    const q = queues.find((x) => x.id === 'leads-waiting')!
    expect(q.count).toBe(1)
    expect(q.items[0].href).toBe('/leads/old')
    const emailText = JSON.stringify({ ref: q.items[0].ref, note: q.items[0].note })
    expect(emailText).not.toMatch(/Pat|Lee|Main St|850/)
    expect(q.items[0].note).toContain('30 hours')
  })
  test('a person\'s own queue', async () => {
    const db = make([lead('mine'), lead('theirs', { owner_user_id: 'adm' })])
    const q = await loadLeadsWaitingQueue(db.client as never, ORG, NOW, { ownerUserId: 'u1' })
    expect(q.items.map((i) => i.id)).toEqual(['mine'])
  })
})

describe('the reminder', () => {
  const run = (db: ReturnType<typeof make>) => runLeadReminderForOrg(db.client as never, { id: ORG, settings: ON }, NOW)
  test('one notification to the owner when a lead crosses N, never a second', async () => {
    const db = make([lead('old', { created_at: ago(25) })])
    expect((await run(db)).notified).toBe(1)
    expect(db.tables.notifications).toEqual([expect.objectContaining({ org_id: ORG, recipient_user_id: 'u1', type: 'lead_waiting', link_url: '/leads/old', data: { lead_id: 'old' } })])
    expect((await run(db)).notified).toBe(0)
    expect(db.tables.notifications).toHaveLength(1)
  })
  test('a lead that crossed long ago is on the queue but not re-announced; contact stops it', async () => {
    const db = make([lead('stale', { created_at: ago(24 * 10) }), lead('called', { created_at: ago(25) })], [{ id: 'a', org_id: ORG, lead_id: 'called', type: 'text', deleted_at: null }])
    expect((await run(db)).notified).toBe(0)
  })
  test('owner gone or unassigned → the company\'s oldest active admin', async () => {
    const db = make([lead('l1', { created_at: ago(25), owner_user_id: 'left' }), lead('l2', { created_at: ago(26), owner_user_id: null })])
    await run(db)
    expect(db.tables.notifications.map((n) => n.recipient_user_id)).toEqual(['adm', 'adm'])
  })
  test('off = nothing', async () => {
    const db = make([lead('old', { created_at: ago(25) })])
    expect((await runLeadReminderForOrg(db.client as never, { id: ORG, settings: {} }, NOW)).notified).toBe(0)
    expect(db.tables.notifications ?? []).toHaveLength(0)
  })
})
