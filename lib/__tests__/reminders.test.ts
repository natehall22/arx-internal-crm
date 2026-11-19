/** @jest-environment node */
/** Reminders: who may be reminded, who sees what, the day on the company's clock, and each bell ringing once. */
jest.mock('@/lib/push-apns', () => ({ sendPushToUserBackground: jest.fn() }))
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { canSeeAllReminders, createReminder, listReminders, notifyDueReminders, parseReminderInput, reminderHref, setReminderDone } from '@/lib/reminders'
import { nextWeekYmd } from '@/components/reminders/RemindButton'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
// 03:30 UTC Nov 21 is still Nov 20 in New York: "today" is the company's day, not the UTC one.
const NOW = new Date('2026-11-21T03:30:00Z')

const make = () =>
  createFakeDb({
    orgs: [{ id: ORG, timezone: 'America/New_York', settings: {} }, { id: OTHER, timezone: 'America/New_York', settings: {} }],
    users: [
      { id: 'me', org_id: ORG, active: true, full_name: 'Me Owner' },
      { id: 'jake', org_id: ORG, active: true, full_name: 'Jake' },
      { id: 'gone', org_id: ORG, active: false, full_name: 'Gone' },
      { id: 'zed', org_id: OTHER, active: true, full_name: 'Zed' },
    ],
    customers: [{ id: 'c1', org_id: ORG }, { id: 'cx', org_id: OTHER }],
    production_jobs: [{ id: 'j1', org_id: ORG }],
    referral_partners: [],
    properties: [],
    reminders: [],
    notifications: [],
  })

describe('parseReminderInput', () => {
  test('needs text, a day not in the past, a person and a record', () => {
    const base = { body: 'Call back', dueOn: '2026-11-20', assigneeId: 'jake', customerId: 'c1' }
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
    const r = await createReminder(db.client as never, ORG, { id: 'me', name: 'Me Owner' }, { assigneeId: 'jake', dueOn: '2026-11-20', body: 'Check sprinkler', customerId: 'c1' }, NOW)
    expect(r.ok).toBe(true)
    expect(db.tables.notifications).toEqual([expect.objectContaining({ org_id: ORG, recipient_user_id: 'jake', type: 'reminder_assigned', link_url: '/customers/c1' })])
    const own = await createReminder(db.client as never, ORG, { id: 'me', name: 'Me' }, { assigneeId: 'me', dueOn: '2026-11-21', body: 'Mine', jobId: 'j1' }, NOW)
    expect(own.ok).toBe(true)
    expect(db.tables.notifications).toHaveLength(1)
    // 2026-11-20 is "today" for the company although it is already the 21st in UTC; the 19th is the past.
    const past = await createReminder(db.client as never, ORG, { id: 'me', name: 'Me' }, { assigneeId: 'jake', dueOn: '2026-11-19', body: 'x', customerId: 'c1' }, NOW)
    expect(past.ok).toBe(false)
  })
  test('refuses an inactive person, another company\'s person and another company\'s record', async () => {
    const db = make()
    const go = (assigneeId: string, customerId: string) => createReminder(db.client as never, ORG, { id: 'me', name: 'Me' }, { assigneeId, dueOn: '2026-11-21', body: 'x', customerId }, NOW)
    expect(await go('gone', 'c1')).toMatchObject({ ok: false, status: 400 })
    expect(await go('zed', 'c1')).toMatchObject({ ok: false, status: 400 })
    expect(await go('jake', 'cx')).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.reminders).toHaveLength(0)
  })
})

describe('who sees and finishes what', () => {
  const seed = async () => {
    const db = make()
    await createReminder(db.client as never, ORG, { id: 'me', name: 'Me' }, { assigneeId: 'jake', dueOn: '2026-11-21', body: 'For Jake', customerId: 'c1' }, NOW)
    await createReminder(db.client as never, ORG, { id: 'me', name: 'Me' }, { assigneeId: 'me', dueOn: '2026-11-22', body: 'For me', customerId: 'c1' }, NOW)
    return db
  }
  test('a person sees theirs; office sees all; another person sees nothing', async () => {
    const db = await seed()
    expect((await listReminders(db.client as never, ORG, { viewerId: 'jake' })).map((r) => r.body)).toEqual(['For Jake'])
    expect((await listReminders(db.client as never, ORG, { viewerId: 'me' })).map((r) => r.body)).toEqual(['For Jake', 'For me'])
    expect(await listReminders(db.client as never, ORG, { viewerId: 'zed' })).toEqual([])
    expect((await listReminders(db.client as never, ORG, { viewerId: 'boss', all: true })).length).toBe(2)
  })
  test('done: the assignee or office; a stranger gets "not found"; done is kept and can be undone', async () => {
    const db = await seed()
    const id = (db.tables.reminders as Array<{ id: string; body: string }>).find((r) => r.body === 'For Jake')!.id
    expect(await setReminderDone(db.client as never, ORG, { id: 'zed', seesAll: false }, id, true)).toMatchObject({ ok: false, status: 404 })
    expect(await setReminderDone(db.client as never, ORG, { id: 'jake', seesAll: false }, id, true)).toEqual({ ok: true })
    expect(await listReminders(db.client as never, ORG, { viewerId: 'jake' })).toEqual([])
    expect((await listReminders(db.client as never, ORG, { viewerId: 'jake', includeDone: true })).length).toBe(1)
    expect(await setReminderDone(db.client as never, ORG, { id: 'me', seesAll: true }, id, false)).toEqual({ ok: true })
    expect((await listReminders(db.client as never, ORG, { viewerId: 'jake' })).length).toBe(1)
  })
})

describe('notifyDueReminders', () => {
  test('rings due and overdue ones once; a second run, done ones and future ones stay quiet', async () => {
    const db = make()
    db.tables.reminders.push(
      { id: 'a', org_id: ORG, assignee_user_id: 'jake', created_by: 'me', body: 'Due', due_on: '2026-11-20', done_at: null, due_notified_at: null, job_id: 'j1' },
      { id: 'b', org_id: ORG, assignee_user_id: 'jake', created_by: 'me', body: 'Late', due_on: '2026-11-18', done_at: null, due_notified_at: null, customer_id: 'c1' },
      { id: 'c', org_id: ORG, assignee_user_id: 'jake', created_by: 'me', body: 'Later', due_on: '2026-11-25', done_at: null, due_notified_at: null, customer_id: 'c1' },
      { id: 'd', org_id: ORG, assignee_user_id: 'jake', created_by: 'me', body: 'Done', due_on: '2026-11-20', done_at: '2026-11-20T01:00:00Z', due_notified_at: null, customer_id: 'c1' },
      { id: 'e', org_id: OTHER, assignee_user_id: 'zed', created_by: 'zed', body: 'Other co', due_on: '2026-11-20', done_at: null, due_notified_at: null, customer_id: 'cx' }
    )
    expect(await notifyDueReminders(db.client as never, ORG, NOW)).toBe(2)
    expect(await notifyDueReminders(db.client as never, ORG, NOW)).toBe(0)
    expect((db.tables.notifications as Array<{ type: string; org_id: string; link_url: string }>).map((n) => [n.type, n.org_id, n.link_url]).sort()).toEqual([
      ['reminder_due', ORG, '/customers/c1'],
      ['reminder_due', ORG, '/ops/jobs/j1'],
    ])
  })
})
