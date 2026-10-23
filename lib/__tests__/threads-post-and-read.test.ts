import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { getTimeline } from '@/lib/threads/get-thread'
import { postMessage } from '@/lib/threads/post-message'
import type { ThreadViewer } from '@/lib/threads/visibility'

const ORG = 'org1'
const mk = (o: Partial<ThreadViewer> & { userId: string }): ThreadViewer => ({
  orgId: ORG, ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false, closerLike: false, setterLike: false, pricingBarred: false, ...o,
})
const V = {
  owner: mk({ userId: 'owner', ownerLike: true, jobBoard: true, jobEdit: true }),
  ops: mk({ userId: 'ops', jobBoard: true, jobEdit: true }),
  closer: mk({ userId: 'closer', closerLike: true }),
  setter: mk({ userId: 'setter', setterLike: true, pricingBarred: true }),
}
const users = [
  { id: 'owner', full_name: 'Nathan Hall', email: 'n@x.com', active: true, role: 'admin', custom_role_id: null, is_super_admin: true, org_id: ORG },
  { id: 'ops', full_name: 'Steve Potts', email: 's@x.com', active: true, role: 'operations', custom_role_id: null, is_super_admin: false, org_id: ORG },
  { id: 'closer', full_name: 'Sam Closer', email: 'c@x.com', active: true, role: 'closer', custom_role_id: null, is_super_admin: false, org_id: ORG },
  { id: 'setter', full_name: 'Jordan Setter', email: 'j@x.com', active: true, role: 'setter', custom_role_id: null, is_super_admin: false, org_id: ORG },
]
const byId: Record<string, ThreadViewer> = { owner: V.owner, ops: V.ops, closer: V.closer, setter: V.setter }
const resolveViewer = async (u: { id: string }) => byId[u.id]
const deal = { id: 'd1', owner_user_id: 'closer', setter_user_id: 'setter', customer_id: 'c1', lead_id: null }
const profile = (id: string) => ({ id, org_id: ORG, role: 'x' })
const fresh = () => createFakeDb({ users, opportunities: [{ org_id: ORG, ...deal }], activities: [], threads: [], thread_members: [] })

async function post(db: ReturnType<typeof fresh>, who: keyof typeof V, draft: Record<string, unknown>) {
  return postMessage(db.client as never, profile(who), deal, { body: 'x', ...draft } as never, { viewer: V[who], resolveViewer: resolveViewer as never })
}

describe('postMessage', () => {
  it('setter posts as Team and can never write Production or Crew', async () => {
    const db = fresh()
    const ok = await post(db, 'setter', { body: 'Homeowner works nights' })
    expect(ok.ok && ok.message.audience).toBe('team')
    for (const audience of ['production', 'crew']) {
      const r = await post(db, 'setter', { body: 'try', audience })
      expect(r.ok).toBe(false)
      expect(!r.ok && r.status).toBe(403)
    }
  })

  it('a setter on someone else\'s deal cannot post at all', async () => {
    const db = fresh()
    const r = await postMessage(db.client as never, profile('setter'), { ...deal, setter_user_id: 'other', owner_user_id: 'x' }, { body: 'hi' }, { viewer: V.setter })
    expect(r.ok).toBe(false)
  })

  it('pricing text is flagged for closers by default and hidden from the setter; opt-in lets setters see it', async () => {
    const db = fresh()
    const r = await post(db, 'closer', { body: 'Signed at $18,400', audience: 'sales' })
    expect(r.ok && r.message.restricted_pricing).toBe(true)
    expect(r.ok && r.pricingNotice).toBe(true)
    const r2 = await post(db, 'closer', { body: 'Signed at $18,400 yay', audience: 'team', allowSetters: true })
    expect(r2.ok && r2.message.restricted_pricing).toBe(false)
  })

  it('a reply inherits the parent audience and pricing flag', async () => {
    const db = fresh()
    const parent = await post(db, 'ops', { body: 'Materials ordered, price $4,000', audience: 'production' })
    if (!parent.ok) throw new Error('x')
    const reply = await post(db, 'closer', { body: 'thanks', audience: 'sales', replyToId: parent.message.id })
    expect(reply.ok && reply.message.audience).toBe('production')
    expect(reply.ok && reply.message.restricted_pricing).toBe(true)
  })

  it('a setter cannot reply to a message they cannot read', async () => {
    const db = fresh()
    const parent = await post(db, 'ops', { body: 'Dumpster Wed', audience: 'production' })
    if (!parent.ok) throw new Error('x')
    const r = await post(db, 'setter', { body: 'what?', replyToId: parent.message.id })
    expect(!r.ok && r.status).toBe(404)
  })

  it('mentions are exact: "@Ste" pings nobody, "@Steve Potts" pings Steve', async () => {
    const db = fresh()
    const none = await post(db, 'closer', { body: '@Ste can you look?', audience: 'team' })
    expect(none.ok && none.message.mentioned_user_ids).toEqual([])
    const one = await post(db, 'closer', { body: '@Steve Potts can you look?', audience: 'team' })
    expect(one.ok && one.message.mentioned_user_ids).toEqual(['ops'])
    expect(one.ok && one.message.priority).toBe('needs_reply')
    expect(one.ok && one.recipients).toEqual([{ userId: 'ops', priority: 'needs_reply', reason: 'mention' }])
  })

  it('mentioning a setter in a Production message pings them blind and never grants access', async () => {
    const db = fresh()
    const r = await post(db, 'ops', { body: '@Jordan Setter dumpster is on the street', audience: 'production' })
    expect(r.ok && r.recipients.map((x) => x.userId)).toEqual([])
    expect(r.ok && r.blindMentions).toEqual(['setter'])
  })

  it('FYI mention is not a needs-reply; urgent is capped at 3 a day', async () => {
    const db = fresh()
    const fyi = await post(db, 'closer', { body: '@Steve Potts fyi gate code 4471', audience: 'team' })
    expect(fyi.ok && fyi.message.priority).toBe('fyi')
    expect((await post(db, 'ops', { body: '@Sam Closer urgent 0', priority: 'urgent', audience: 'production' })).ok).toBe(true)
    // the fake db has no column defaults, so stamp created_at like Postgres would
    for (const r of db.tables.activities) r.created_at ??= new Date().toISOString()
    for (let i = 1; i < 3; i++) db.tables.activities.push({ id: `u${i}`, org_id: ORG, user_id: 'ops', priority: 'urgent', created_at: new Date().toISOString() })
    const fourth = await post(db, 'ops', { body: '@Sam Closer urgent 4', priority: 'urgent', audience: 'production' })
    expect(!fourth.ok && fourth.status).toBe(429)
  })

  it('urgent / needs-reply with nobody to wait on is just FYI (and burns no urgent slot)', async () => {
    const db = fresh()
    const r = await post(db, 'ops', { body: 'heads up', priority: 'urgent', audience: 'production' })
    expect(r.ok && r.message.priority).toBe('fyi')
  })

  it('a needs-reply reply with no @ still waits on the author of the message replied to', async () => {
    const db = fresh()
    const parent = await post(db, 'closer', { body: 'Wife picked Onyx', audience: 'team' })
    if (!parent.ok) throw new Error('x')
    const r = await post(db, 'ops', { body: 'confirming the color', audience: 'team', replyToId: parent.message.id, priority: 'needs_reply' })
    expect(r.ok && r.recipients).toEqual([{ userId: 'closer', priority: 'needs_reply', reason: 'reply' }])
  })

  it('a reply must stay on the same deal', async () => {
    const db = fresh()
    db.tables.activities.push({ id: 'other', org_id: ORG, opportunity_id: 'd9', user_id: 'closer', body: 'elsewhere', audience: 'team', created_at: new Date().toISOString() })
    const r = await post(db, 'closer', { body: 'hi', audience: 'team', replyToId: 'other' })
    expect(!r.ok && r.status).toBe(404)
  })

  it('retrying the same client_id never doubles a message', async () => {
    const db = fresh()
    const a = await post(db, 'closer', { body: 'hello', audience: 'team', clientId: 'c-1' })
    const b = await post(db, 'closer', { body: 'hello', audience: 'team', clientId: 'c-1' })
    expect(a.ok && b.ok && a.message.id === b.message.id).toBe(true)
    expect(db.tables.activities).toHaveLength(1)
  })
})

describe('getTimeline — all deals scope', () => {
  it('checks each message against ITS OWN deal: a setter on deal A never reads deal B of the same customer', async () => {
    const db = createFakeDb({
      opportunities: [
        { id: 'dA', org_id: ORG, owner_user_id: 'closer', setter_user_id: 'setter', customer_id: 'c1', lead_id: null },
        { id: 'dB', org_id: ORG, owner_user_id: 'closer2', setter_user_id: 'setter2', customer_id: 'c1', lead_id: null },
      ],
      scheduled_appointments: [],
      activities: [
        { id: 'a1', org_id: ORG, opportunity_id: 'dA', customer_id: 'c1', user_id: 'closer', type: 'note', body: 'mine', audience: 'team', origin: 'human', created_at: '2026-10-01T00:00:00Z' },
        { id: 'b1', org_id: ORG, opportunity_id: 'dB', customer_id: 'c1', user_id: 'closer2', type: 'note', body: 'theirs', audience: 'team', origin: 'human', created_at: '2026-10-02T00:00:00Z' },
        { id: 'n1', org_id: ORG, opportunity_id: null, customer_id: 'c1', user_id: 'closer2', type: 'note', body: 'customer-level', audience: 'team', origin: 'human', created_at: '2026-10-03T00:00:00Z' },
      ],
    })
    const dealA = { id: 'dA', owner_user_id: 'closer', setter_user_id: 'setter', customer_id: 'c1', lead_id: null, address_text: null, status: null }
    const t = await getTimeline(db.client as never, V.setter, dealA as never, { scope: 'customer' })
    expect(t.messages.map((m) => m.body)).toEqual(['mine'])
    const o = await getTimeline(db.client as never, V.owner, dealA as never, { scope: 'customer' })
    expect(o.messages.map((m) => m.body).sort()).toEqual(['customer-level', 'mine', 'theirs'])
  })
})

describe('getTimeline', () => {
  async function seeded() {
    const db = fresh()
    await post(db, 'setter', { body: 'door note from setter' })
    await post(db, 'closer', { body: 'Signed at $18,400', audience: 'sales' })
    await post(db, 'closer', { body: 'Wife picked Onyx', audience: 'sales' })
    await post(db, 'ops', { body: 'Delivery Wed AM', audience: 'production' })
    await post(db, 'ops', { body: 'Tarp the AC unit', audience: 'crew' })
    db.tables.activities.push({ id: 'sys1', org_id: ORG, opportunity_id: 'd1', customer_id: 'c1', user_id: null, type: 'status_change', body: 'Status → Scheduled', created_at: new Date().toISOString() })
    return db
  }
  const bodies = (t: { messages: { body: string }[] }) => t.messages.map((m) => m.body)

  it('setter sees team + non-pricing sales talk only: no production, crew or pricing', async () => {
    const db = await seeded()
    const t = await getTimeline(db.client as never, V.setter, { ...deal } as never)
    const b = bodies(t)
    expect(b).toContain('door note from setter')
    expect(b).toContain('Wife picked Onyx')
    expect(b).not.toContain('Signed at $18,400')
    expect(b).not.toContain('Delivery Wed AM')
    expect(b).not.toContain('Tarp the AC unit')
  })

  it('ops sees production + crew and Sales is behind the "Sales history" chip', async () => {
    const db = await seeded()
    const t = await getTimeline(db.client as never, V.ops, { ...deal } as never)
    expect(bodies(t)).toEqual(expect.arrayContaining(['Delivery Wed AM', 'Tarp the AC unit']))
    expect(bodies(t)).not.toContain('Wife picked Onyx')
    expect(t.hiddenSalesCount).toBeGreaterThan(0)
    const withSales = await getTimeline(db.client as never, V.ops, { ...deal } as never, { audiences: ['sales'] })
    expect(bodies(withSales)).toContain('Wife picked Onyx')
  })

  it('owner sees everything; humanOnly drops system rows; a deleted message is a tombstone with no text', async () => {
    const db = await seeded()
    const all = await getTimeline(db.client as never, V.owner, { ...deal } as never)
    expect(bodies(all)).toContain('Status → Scheduled')
    const human = await getTimeline(db.client as never, V.owner, { ...deal } as never, { humanOnly: true })
    expect(bodies(human)).not.toContain('Status → Scheduled')
    const target = db.tables.activities.find((r) => r.body === 'Wife picked Onyx')!
    target.deleted_at = new Date().toISOString()
    const after = await getTimeline(db.client as never, V.owner, { ...deal } as never)
    const t = after.messages.find((m) => m.id === target.id)!
    expect(t.deleted).toBe(true)
    expect(t.body).toBe('')
  })

  it('a closer on someone else\'s deal sees nothing', async () => {
    const db = await seeded()
    const t = await getTimeline(db.client as never, mk({ userId: 'closer2', closerLike: true }), { ...deal } as never)
    expect(t.messages).toEqual([])
  })

  it('pins: customer alerts honour the audience, expired pins drop off', async () => {
    const db = await seeded()
    const prod = db.tables.activities.find((r) => r.body === 'Tarp the AC unit')!
    Object.assign(prod, { pinned_at: new Date().toISOString(), pin_scope: 'customer' })
    const sales = db.tables.activities.find((r) => r.body === 'Wife picked Onyx')!
    Object.assign(sales, { pinned_at: new Date().toISOString(), pin_scope: 'deal', pin_expires_at: new Date(Date.now() - 1000).toISOString() })
    const t = await getTimeline(db.client as never, V.owner, { ...deal } as never)
    expect(t.pinned.map((m) => m.body)).toEqual(['Tarp the AC unit'])
    const forSetter = await getTimeline(db.client as never, V.setter, { ...deal } as never)
    expect(forSetter.pinned).toEqual([])
  })
})

describe('crew notes', () => {
  it('a price-looking crew note is always flagged, and the crew reader only returns unflagged crew-audience text', async () => {
    const { loadCrewNotes } = await import('@/lib/threads/crew-notes')
    const db = createFakeDb({
      production_jobs: [{ id: 'j1', org_id: ORG, project_id: 'p1' }],
      projects: [{ id: 'p1', org_id: ORG, opportunity_id: 'd1' }],
      opportunities: [{ org_id: ORG, ...deal }],
      users, activities: [], threads: [], thread_members: [],
    })
    const post2 = (who: keyof typeof V, draft: Record<string, unknown>) =>
      postMessage(db.client as never, profile(who), deal, { body: 'x', ...draft } as never, { viewer: V[who], resolveViewer: resolveViewer as never })
    const ok = await post2('ops', { body: 'Tarp the AC unit. Park on the street.', audience: 'crew' })
    const priced = await post2('ops', { body: 'Customer paid $4,000 so be nice', audience: 'crew', allowSetters: true })
    await post2('ops', { body: 'Sales secret', audience: 'sales' })
    await post2('ops', { body: 'Production only', audience: 'production' })
    expect(priced.ok && priced.message.restricted_pricing).toBe(true)
    const notes = await loadCrewNotes(db.client as never, { orgId: ORG, jobId: 'j1', workOrderId: 'wo1' })
    expect(notes.map((n) => n.body)).toEqual(['Tarp the AC unit. Park on the street.'])
    expect(Object.keys(notes[0]).sort()).toEqual(['body', 'created_at', 'id'])
    expect(ok.ok).toBe(true)
  })
})
