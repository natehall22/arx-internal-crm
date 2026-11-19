/** @jest-environment node */
/** Reminders: who may be reminded, who sees what, the day on the company's clock, and each bell ringing once. */
jest.mock('@/lib/push-apns', () => ({ sendPushToUserBackground: jest.fn() }))
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { canSeeAllReminders, createReminder, listReminders, notifyDueReminders, parseReminderInput, reminderHref, setReminderDone } from '@/lib/reminders'
import { loadRemindersQueue } from '@/lib/today'
import { nextWeekYmd } from '@/components/reminders/RemindButton'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [ME, JAKE, GONE, ZED, C1, CX, J1, BOSS] = [1, 2, 3, 4, 5, 6, 7, 8].map(id)
// The person making the reminder: owner-like sees every record; "field" is a setter-type who sees no job board and no customers.
const NOBODY = { ownerLike: false, jobBoard: false, managerLike: false, closerLike: false, setterLike: true }
const viewer = (over: Record<string, unknown> = {}) => ({ userId: ME, orgId: ORG, ownerLike: true, jobBoard: true, managerLike: false, pricingBarred: false, ...over }) as never
const actor = (over: Record<string, unknown> = {}) => ({ id: ME, name: 'Me', viewer: viewer(over) })
// 03:30 UTC Nov 21 is still Nov 20 in New York: "today" is the company's day, not the UTC one.
const NOW = new Date('2026-11-21T03:30:00Z')

let seq = 100
const make = () =>
  createFakeDb({
    orgs: [{ id: ORG, timezone: 'America/New_York', settings: {} }, { id: OTHER, timezone: 'America/New_York', settings: {} }],
    users: [
      { id: ME, org_id: ORG, active: true, full_name: 'Me Owner' },
      { id: JAKE, org_id: ORG, active: true, full_name: 'Jake' },
      { id: GONE, org_id: ORG, active: false, full_name: 'Gone' },
      { id: ZED, org_id: OTHER, active: true, full_name: 'Zed' },
    ],
    customers: [{ id: C1, org_id: ORG }, { id: CX, org_id: OTHER }],
    production_jobs: [{ id: J1, org_id: ORG }],
    referral_partners: [],
    properties: [],
    reminders: [],
    notifications: [],
    opportunities: [],
  }, { idFactory: () => id(seq++) })

describe('parseReminderInput', () => {
  test('needs text, a day not in the past, a person and a record', () => {
    const base = { body: 'Call back', dueOn: '2026-11-20', assigneeId: JAKE, customerId: C1 }
    expect(parseReminderInput(base, '2026-11-20').ok).toBe(true)
    expect(parseReminderInput({ ...base, body: '  ' }, '2026-11-20')).toMatchObject({ ok: false })
    expect(parseReminderInput({ ...base, body: 'x'.repeat(501) }, '2026-11-20')).toMatchObject({ ok: false })
    expect(parseReminderInput({ ...base, dueOn: '2026-11-19' }, '2026-11-20')).toMatchObject({ ok: false, error: 'Pick today or a day after' })
    expect(parseReminderInput({ ...base, dueOn: 'soon' }, '2026-11-20')).toMatchObject({ ok: false })
    expect(parseReminderInput({ ...base, assigneeId: '' }, '2026-11-20')).toMatchObject({ ok: false })
    expect(parseReminderInput({ ...base, customerId: undefined }, '2026-11-20')).toMatchObject({ ok: false })
  })
})

describe('chips + links + office', () => {
  test('"Next week" is the next Monday', () => {
    expect(nextWeekYmd('2026-11-20')).toBe('2026-11-23') // Friday
    expect(nextWeekYmd('2026-11-23')).toBe('2026-11-30') // Monday -> a week later, never today
    expect(nextWeekYmd('2026-11-22')).toBe('2026-11-23') // Sunday
  })
  test('each record opens its own page', () => {
    expect(reminderHref({ jobId: 'j', customerId: 'c', partnerId: null })).toBe('/ops/jobs/j')
    expect(reminderHref({ jobId: null, customerId: 'c', partnerId: null })).toBe('/customers/c')
    expect(reminderHref({ jobId: null, customerId: null, partnerId: 'p' })).toBe('/referral-partners/p')
  })
  test('owner, admin and operations see everyone', () => {
    expect(canSeeAllReminders({ role: 'operations' })).toBe(true)
    expect(canSeeAllReminders({ role: 'rep', is_super_admin: true })).toBe(true)
    expect(canSeeAllReminders({ role: 'sales_rep' })).toBe(false)
    expect(canSeeAllReminders({ role: 'admin', active: false })).toBe(false)
  })
})

describe('createReminder', () => {
  test('uses the company day, rings the assignee once, none for yourself', async () => {
    const db = make()
    const r = await createReminder(db.client as never, ORG, actor(), { assigneeId: JAKE, dueOn: '2026-11-20', body: 'Check sprinkler', customerId: C1 }, NOW)
    expect(r.ok).toBe(true)
    expect(db.tables.notifications).toEqual([expect.objectContaining({ org_id: ORG, recipient_user_id: JAKE, type: 'reminder_assigned', link_url: `/customers/${C1}` })])
    const own = await createReminder(db.client as never, ORG, actor(), { assigneeId: ME, dueOn: '2026-11-21', body: 'Mine', jobId: J1 }, NOW)
    expect(own.ok).toBe(true)
    expect(db.tables.notifications).toHaveLength(1)
    // 2026-11-20 is "today" for the company although it is already the 21st in UTC; the 19th is the past.
    const past = await createReminder(db.client as never, ORG, actor(), { assigneeId: JAKE, dueOn: '2026-11-19', body: 'x', customerId: C1 }, NOW)
    expect(past.ok).toBe(false)
  })
  test('refuses an inactive person, another company\'s person and another company\'s record', async () => {
    const db = make()
    const go = (assigneeId: string, customerId: string) => createReminder(db.client as never, ORG, actor(), { assigneeId, dueOn: '2026-11-21', body: 'x', customerId }, NOW)
    expect(await go(GONE, C1)).toMatchObject({ ok: false, status: 400 })
    expect(await go(ZED, C1)).toMatchObject({ ok: false, status: 400 })
    expect(await go(JAKE, CX)).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.reminders).toHaveLength(0)
  })
})


describe('creator must be able to open the record', () => {
  const go = (db: ReturnType<typeof make>, view: Record<string, unknown>, t: Record<string, unknown>) =>
    createReminder(db.client as never, ORG, actor(view), { assigneeId: JAKE, dueOn: '2026-11-21', body: 'x', ...t } as never, NOW)
  test('a person without the job board cannot attach a reminder to a job, nor to a customer they cannot open; 404 like a missing record', async () => {
    const db = make()
    expect(await go(db, NOBODY, { jobId: J1 })).toMatchObject({ ok: false, status: 404 })
    expect(await go(db, NOBODY, { customerId: C1 })).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.reminders).toHaveLength(0)
    expect(await go(db, { jobBoard: true }, { jobId: J1 })).toMatchObject({ ok: true })
  })
  test('a partner is visible to everyone in the company', async () => {
    const db = make()
    db.tables.referral_partners.push({ id: id(20), org_id: ORG })
    expect(await go(db, NOBODY, { partnerId: id(20) })).toMatchObject({ ok: true })
  })
  test('ids must be UUIDs: junk is a 400, never a database error', async () => {
    const db = make()
    expect(await go(db, {}, { customerId: 'not-a-uuid' })).toMatchObject({ ok: false, status: 400 })
    expect(await createReminder(db.client as never, ORG, actor(), { assigneeId: 'jake', dueOn: '2026-11-21', body: 'x', customerId: C1 } as never, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await setReminderDone(db.client as never, ORG, { id: ME, seesAll: true }, 'nope', true)).toMatchObject({ ok: false, status: 400 })
  })
})

describe('bells: insert first, claim second', () => {
  const dueRow = (over: Record<string, unknown> = {}) => ({ id: id(50), org_id: ORG, assignee_user_id: JAKE, created_by: ME, body: 'Ring', due_on: '2026-11-20', done_at: null, due_notified_at: null, assigned_notified_at: null, customer_id: C1, ...over })
  test('a failed notification insert leaves the claim empty, so the next run retries it', async () => {
    const db = make()
    db.tables.reminders.push(dueRow())
    const realFrom = (db.client as unknown as { from: (t: string) => unknown }).from.bind(db.client)
    let fail = true
    ;(db.client as { from: unknown }).from = (table: string) => {
      const q = (realFrom as (t: string) => unknown)(table) as { insert: (...a: unknown[]) => unknown }
      if (table === 'notifications' && fail) return { ...q, insert: () => Promise.resolve({ data: null, error: { message: 'down', code: '08006' } }) }
      return q
    }
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await notifyDueReminders(db.client as never, ORG, NOW)).toBe(0)
    expect(db.tables.reminders[0].due_notified_at).toBeNull()
    fail = false
    expect(await notifyDueReminders(db.client as never, ORG, NOW)).toBe(1)
    expect(db.tables.reminders[0].due_notified_at).not.toBeNull()
  })
  test('a bell that was already inserted (unique index) is not rung again, and the claim is still set', async () => {
    const db = make()
    db.tables.reminders.push(dueRow())
    const realFrom = (db.client as unknown as { from: (t: string) => unknown }).from.bind(db.client)
    ;(db.client as { from: unknown }).from = (table: string) => {
      const q = (realFrom as (t: string) => unknown)(table) as { insert: (...a: unknown[]) => unknown }
      return table === 'notifications' ? { ...q, insert: () => Promise.resolve({ data: null, error: { message: 'duplicate', code: '23505' } }) } : q
    }
    expect(await notifyDueReminders(db.client as never, ORG, NOW)).toBe(0)
    expect(db.tables.reminders[0].due_notified_at).not.toBeNull()
  })
  test('a reminder due on an earlier day says overdue, not "due today"', async () => {
    const db = make()
    db.tables.reminders.push(dueRow({ due_on: '2026-11-18' }), dueRow({ id: id(51), due_on: '2026-11-20' }))
    await notifyDueReminders(db.client as never, ORG, NOW)
    const notes = db.tables.notifications as Array<{ title: string; body: string }>
    expect(notes.map((n) => n.title).sort()).toEqual(['Reminder due today', 'Reminder overdue'])
    expect(notes.find((n) => n.title === 'Reminder overdue')!.body).toMatch(/^Overdue/)
  })
})

describe('who sees and finishes what', () => {
  const seed = async () => {
    const db = make()
    await createReminder(db.client as never, ORG, actor(), { assigneeId: JAKE, dueOn: '2026-11-21', body: 'For Jake', customerId: C1 }, NOW)
    await createReminder(db.client as never, ORG, actor(), { assigneeId: ME, dueOn: '2026-11-22', body: 'For me', customerId: C1 }, NOW)
    return db
  }
  test('a person sees theirs; office sees all; another person sees nothing', async () => {
    const db = await seed()
    expect((await listReminders(db.client as never, ORG, { viewerId: JAKE })).map((r) => r.body)).toEqual(['For Jake'])
    expect((await listReminders(db.client as never, ORG, { viewerId: ME })).map((r) => r.body)).toEqual(['For Jake', 'For me'])
    expect(await listReminders(db.client as never, ORG, { viewerId: ZED })).toEqual([])
    expect((await listReminders(db.client as never, ORG, { viewerId: BOSS, all: true })).length).toBe(2)
  })
  test('done: the assignee or office; a stranger gets "not found"; done is kept and can be undone', async () => {
    const db = await seed()
    const id = (db.tables.reminders as Array<{ id: string; body: string }>).find((r) => r.body === 'For Jake')!.id
    expect(await setReminderDone(db.client as never, ORG, { id: ZED, seesAll: false }, id, true)).toMatchObject({ ok: false, status: 404 })
    expect(await setReminderDone(db.client as never, ORG, { id: JAKE, seesAll: false }, id, true)).toEqual({ ok: true })
    expect(await listReminders(db.client as never, ORG, { viewerId: JAKE })).toEqual([])
    expect((await listReminders(db.client as never, ORG, { viewerId: JAKE, includeDone: true })).length).toBe(1)
    // the one who made it can finish it too, without office rights
    expect(await setReminderDone(db.client as never, ORG, { id: ME, seesAll: false }, id, false)).toEqual({ ok: true })
    expect((await listReminders(db.client as never, ORG, { viewerId: JAKE })).length).toBe(1)
  })
})

describe('notifyDueReminders', () => {
  test('rings due and overdue ones once; a second run, done ones and future ones stay quiet', async () => {
    const db = make()
    db.tables.reminders.push(
      { id: 'a', org_id: ORG, assignee_user_id: JAKE, created_by: ME, body: 'Due', due_on: '2026-11-20', done_at: null, due_notified_at: null, job_id: J1 },
      { id: 'b', org_id: ORG, assignee_user_id: JAKE, created_by: ME, body: 'Late', due_on: '2026-11-18', done_at: null, due_notified_at: null, customer_id: C1 },
      { id: 'c', org_id: ORG, assignee_user_id: JAKE, created_by: ME, body: 'Later', due_on: '2026-11-25', done_at: null, due_notified_at: null, customer_id: C1 },
      { id: 'd', org_id: ORG, assignee_user_id: JAKE, created_by: ME, body: 'Done', due_on: '2026-11-20', done_at: '2026-11-20T01:00:00Z', due_notified_at: null, customer_id: C1 },
      { id: 'e', org_id: OTHER, assignee_user_id: ZED, created_by: ZED, body: 'Other co', due_on: '2026-11-20', done_at: null, due_notified_at: null, customer_id: CX }
    )
    expect(await notifyDueReminders(db.client as never, ORG, NOW)).toBe(2)
    expect(await notifyDueReminders(db.client as never, ORG, NOW)).toBe(0)
    expect((db.tables.notifications as Array<{ type: string; org_id: string; link_url: string }>).map((n) => [n.type, n.org_id, n.link_url]).sort()).toEqual([
      ['reminder_due', ORG, `/customers/${C1}`],
      ['reminder_due', ORG, `/ops/jobs/${J1}`],
    ])
  })
})

describe('Today: My reminders', () => {
  test('due today + overdue are the list and the count; later days are collapsed under "upcoming"', async () => {
    const db = make()
    const row = (n: number, due: string, body: string) => ({ id: id(60 + n), org_id: ORG, assignee_user_id: JAKE, created_by: ME, body, due_on: due, done_at: null, customer_id: C1 })
    db.tables.reminders.push(row(1, '2026-11-18', 'Late'), row(2, '2026-11-20', 'Today'), row(3, '2026-11-24', 'Next week'), row(4, '2026-11-22', 'Weekend'))
    const q = await loadRemindersQueue(db.client as never, ORG, { id: JAKE }, 'mine', NOW)
    expect(q.count).toBe(2)
    expect(q.items.map((i) => i.title)).toEqual(['Late', 'Today'])
    expect(q.upcoming?.map((i) => i.title)).toEqual(['Weekend', 'Next week'])
    const none = await loadRemindersQueue(db.client as never, ORG, { id: ME }, 'mine', NOW)
    expect(none.upcoming).toBeUndefined()
  })
})
