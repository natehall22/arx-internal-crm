import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { listWaiting, redactThreadNotifications, REDACTED_BODY, REDACTED_TITLE } from '@/lib/threads/waiting'
import type { ThreadViewer } from '@/lib/threads/visibility'

const ORG = 'org1'
const setter: ThreadViewer = { userId: 'u1', orgId: ORG, ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: true, pricingBarred: true }
const closer: ThreadViewer = { ...setter, userId: 'c1', setterLike: false, closerLike: true, pricingBarred: false }

const note = (id: string, activity: string, extra: Record<string, unknown> = {}) => ({ id, recipient_user_id: 'u1', org_id: ORG, type: 'thread_needs_reply', priority: 'needs_reply', title: `T-${id}`, body: `secret body ${id}`, link_url: `/c/x/d/y/m/${activity}`, activity_id: activity, created_at: `2026-10-2${id.slice(-1)}T12:00:00Z`, resolved_at: null, ...extra })
const act = (id: string, extra: Record<string, unknown> = {}) => ({ id, org_id: ORG, opportunity_id: 'o1', audience: 'team', restricted_pricing: false, deleted_at: null, ...extra })

const seed = () => createFakeDb({
  opportunities: [{ id: 'o1', org_id: ORG, owner_user_id: 'c1', setter_user_id: 'u1' }],
  activities: [act('a1'), act('a2', { audience: 'production' }), act('a3', { deleted_at: '2026-10-22T00:00:00Z' }), act('a4', { audience: 'sales', restricted_pricing: true }), act('a5', { audience: 'team', opportunity_id: 'other-deal' })],
  notifications: [note('n1', 'a1'), note('n2', 'a2'), note('n3', 'a3'), note('n4', 'a4'), note('n5', 'a5'), note('n6', 'a2', { type: 'thread_mention_blind', priority: 'fyi', title: 'Riley mentioned you', body: 'Mentioned you in a message you do not have access to' })],
  opportunity_stub: [],
})

describe('Waiting on you / the bell never return text the person can no longer read', () => {
  it('a setter keeps the message they can read and gets redacted rows for production, deleted, pricing and someone else\'s deal', async () => {
    const db = seed()
    const items = await listWaiting(db.client, setter)
    const by = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(by.n1).toMatchObject({ title: 'T-n1', body: 'secret body n1' })
    expect(by.n1.redacted).toBeUndefined()
    for (const id of ['n2', 'n3', 'n4', 'n5']) {
      expect(by[id]).toMatchObject({ title: REDACTED_TITLE, body: REDACTED_BODY, link_url: null, redacted: true })
      expect(JSON.stringify(by[id])).not.toContain('secret body')
    }
    // a blind mention is already text-free: unchanged
    expect(by.n6).toMatchObject({ title: 'Riley mentioned you', blind: true })
  })

  it('the same notifications are fully readable to a person who can read them (the deal\'s closer)', async () => {
    const db = seed()
    const rows = (db.tables.notifications as Array<Record<string, unknown>>).map((n) => ({ ...n, recipient_user_id: 'c1' }))
    const out = await redactThreadNotifications(db.client, closer, rows as never)
    expect(out.filter((n) => (n as { redacted?: boolean }).redacted).map((n) => (n as { id?: string }).id)).toEqual(['n3', 'n5']) // deleted, and another deal's
  })

  it('rows that do not point at a message pass through untouched', async () => {
    const db = seed()
    const rows = [{ id: 'x', type: 'appointment', title: 'Appt', body: 'b', link_url: '/a', activity_id: null }]
    expect(await redactThreadNotifications(db.client, setter, rows)).toEqual(rows)
  })
})
