/** Private notes (owner decision 2026-11-23): who reads, who writes, the SQL mirror, and the write path's refusals. */
import fs from 'fs'
import path from 'path'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { getTimeline } from '@/lib/threads/get-thread'
import { postMessage } from '@/lib/threads/post-message'
import { visibleActivities } from '@/lib/threads/legacy-feed'
import {
  AUDIENCES, canReadMessage, canReadRowOnDeal, canReclassify, defaultAudience, writableAudiences,
  type MessageGate, type ThreadViewer,
} from '@/lib/threads/visibility'

const base: ThreadViewer = {
  userId: 'u', orgId: 'o', ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false,
  closerLike: false, setterLike: false, pricingBarred: false,
}
const V = {
  owner: { ...base, userId: 'owner', ownerLike: true, jobBoard: true, jobEdit: true },
  ops: { ...base, userId: 'ops', jobBoard: true, jobEdit: true },
  manager: { ...base, userId: 'mgr', managerLike: true, jobBoard: true },
  jobBoardUser: { ...base, userId: 'jb', jobBoard: true },
  closer: { ...base, userId: 'closer', closerLike: true },
  setter: { ...base, userId: 'setter', setterLike: true, pricingBarred: true },
  insideSales: { ...base, userId: 'inside', pricingBarred: true, insideSales: true },
  stranger: { ...base, userId: 'sub1' },
}
const deal = { owner_user_id: 'closer', setter_user_id: 'setter' }
const note = (visible: string[] = [], writer = 'owner'): MessageGate => ({ audience: 'private', restricted_pricing: false, visible_user_ids: visible, user_id: writer })

describe('private notes: who reads', () => {
  it('every owner reads, listed or not', () => {
    expect(canReadMessage(V.owner, deal, note())).toBe(true)
    expect(canReadMessage({ ...V.owner, userId: 'owner2' }, deal, note())).toBe(true)
  })
  it('a listed user reads, whatever their role', () => {
    for (const [name, v] of Object.entries(V)) expect([name, canReadMessage(v, deal, note([v.userId]))]).toEqual([name, true])
  })
  it('a listed field role reads it (the owner\'s explicit pick beats the field-role deny), on or off their deals', () => {
    expect(canReadMessage(V.setter, null, note(['setter']))).toBe(true)
    expect(canReadMessage(V.insideSales, { owner_user_id: 'x', setter_user_id: 'y' }, note(['inside']))).toBe(true)
    expect(canReadRowOnDeal(V.setter, 'none', note(['setter']))).toBe(true)
    expect(canReadRowOnDeal(V.closer, 'none', note(['closer']))).toBe(true)
  })
  it('an unlisted manager, ops, job-board user, closer on the deal, setter or stranger does not', () => {
    for (const name of ['ops', 'manager', 'jobBoardUser', 'closer', 'setter', 'insideSales', 'stranger'] as const) {
      expect([name, canReadMessage(V[name], deal, note(['someone-else']))]).toEqual([name, false])
      expect([name, canReadRowOnDeal(V[name], deal, note())]).toEqual([name, false])
    }
  })
  it('the writer reads their own note', () => {
    expect(canReadMessage(V.ops, deal, note([], 'ops'))).toBe(true)
  })
  it('a row with no list and no writer (a caller that did not select them) is owners-only: it fails closed', () => {
    expect(canReadMessage(V.ops, deal, { audience: 'private' })).toBe(false)
    expect(canReadMessage(V.owner, deal, { audience: 'private' })).toBe(true)
  })
  it('the pricing flag does not hide a private note from a listed pricing-barred reader', () => {
    expect(canReadMessage(V.setter, deal, { ...note(['setter']), restricted_pricing: true })).toBe(true)
  })
})

describe('private notes: who writes', () => {
  it('only owners may write it', () => {
    expect(writableAudiences(V.owner, deal)).toContain('private')
    for (const name of ['ops', 'manager', 'jobBoardUser', 'closer', 'setter', 'insideSales', 'stranger'] as const) {
      expect(writableAudiences(V[name], deal, true)).not.toContain('private')
    }
  })
  it('is never the default pick, and never moved onto or off after the fact', () => {
    expect(defaultAudience(V.owner, { surface: 'other', lastUsed: 'private' }, deal)).toBe('team')
    expect(defaultAudience(V.owner, { surface: 'other', replyTo: { audience: 'private' } }, deal)).toBe('private')
    for (const v of Object.values(V)) {
      expect(canReclassify(v, 'private', 'team')).toBe(false)
      expect(canReclassify(v, 'team', 'private')).toBe(false)
    }
  })
})

describe('private notes: the database mirror (migration 202612010010)', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202612010010_private_notes.sql'), 'utf8')
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  const fn = code.slice(code.indexOf('function arx_private.message_visible_to'))
  const prior = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611120060_customer_portal.sql'), 'utf8')
  const strip = (t: string) => t.split('\n').map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean)

  it('the audience check lists exactly the app\'s audiences', () => {
    const list = (code.match(/activities_audience_check check \(audience is null or audience in \(([^)]*)\)/) || [])[1] || ''
    expect(list.split(',').map((x) => x.trim().replace(/'/g, '')).sort()).toEqual([...AUDIENCES].sort())
  })
  it('keeps every other branch of the evaluator byte-identical to 202611120060 and adds only the private branch', () => {
    const from = code.indexOf('create or replace function arx_private.message_visible_to(')
    const seven = code.slice(from, code.indexOf('$$;', from))
    const was = prior.slice(prior.indexOf('create or replace function arx_private.message_visible_to('))
    const wasBody = strip(was.slice(0, was.indexOf('$$;')))
    const nowBody = strip(seven)
    const added = nowBody.filter((l) => !wasBody.includes(l))
    // the signature line grows by the two parameters, the private branch is one line; nothing else is new
    expect(added).toEqual([
      'p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid, p_allowed uuid[], p_author uuid',
      "when p_audience = 'private' then coalesce(p_viewer = p_author or p_viewer = any(coalesce(p_allowed, '{}'::uuid[])), false)",
    ])
    expect(wasBody.filter((l) => !nowBody.includes(l))).toEqual(['p_viewer uuid, p_audience text, p_restricted boolean, p_org uuid, p_opportunity uuid'])
  })
  it('the private branch sits after the owner branch and before the role checks, like canReadMessage', () => {
    const owner = fn.indexOf('select owner_like from g')
    const priv = fn.indexOf("p_audience = 'private'")
    const recognized = fn.indexOf('select recognized from g), false) then false')
    expect(owner).toBeGreaterThan(0)
    expect(priv).toBeGreaterThan(owner)
    expect(recognized).toBeGreaterThan(priv)
  })
  it('the read policy, search_messages and search_work pass the message\'s own list and writer', () => {
    expect(code).toMatch(/public\.message_visible_to\(\(select auth\.uid\(\)\), audience, restricted_pricing, org_id, opportunity_id, visible_user_ids, user_id\)/)
    expect(code.match(/arx_private\.message_visible_to\(p_viewer, a\.audience, a\.restricted_pricing, a\.org_id, a\.opportunity_id, a\.visible_user_ids, a\.user_id\)/g)).toHaveLength(2)
  })
  it('only a private row may carry a list', () => {
    expect(code).toContain('check (visible_user_ids is null or audience = \'private\')')
  })
})

describe('private notes: reading and writing through the thread code', () => {
  const ORG = 'org1'
  const mk = (o: Partial<ThreadViewer> & { userId: string }): ThreadViewer => ({ ...base, orgId: ORG, ...o })
  const W = {
    owner: mk({ userId: 'owner', ownerLike: true, jobBoard: true, jobEdit: true }),
    ops: mk({ userId: 'ops', jobBoard: true, jobEdit: true }),
    closer: mk({ userId: 'closer', closerLike: true }),
    setter: mk({ userId: 'setter', setterLike: true, pricingBarred: true }),
  }
  const user = (id: string, role: string, org = ORG, active = true) => ({ id, full_name: `Person ${id}`, email: `${id}@x.com`, active, role, custom_role_id: null, is_super_admin: id === 'owner', org_id: org })
  const users = [user('owner', 'admin'), user('ops', 'operations'), user('closer', 'closer'), user('setter', 'setter'), user('gone', 'closer', ORG, false), user('alien', 'closer', 'org2')]
  const dealRow = { id: 'd1', owner_user_id: 'closer', setter_user_id: 'setter', customer_id: 'c1', lead_id: null }
  const profile = (id: string) => ({ id, org_id: ORG, role: 'x' })
  const fresh = () => createFakeDb({ users, opportunities: [{ org_id: ORG, ...dealRow }], activities: [], threads: [], thread_members: [] })
  const byId: Record<string, ThreadViewer> = W
  const resolveViewer = async (u: { id: string }) => byId[u.id] ?? mk({ userId: u.id })
  const post = (db: ReturnType<typeof fresh>, who: keyof typeof W, draft: Record<string, unknown>) =>
    postMessage(db.client as never, profile(who), dealRow, { body: 'x', ...draft } as never, { viewer: W[who], resolveViewer: resolveViewer as never })

  it('an owner posts a private note with picked people; it is stored with the list and only they can read it', async () => {
    const db = fresh()
    const r = await post(db, 'owner', { body: 'Customer is in a dispute', audience: 'private', visibleUserIds: ['ops', 'setter', 'owner'] })
    expect(r.ok).toBe(true)
    const row = db.tables.activities.find((a) => r.ok && a.id === r.message.id)
    expect(row).toMatchObject({ audience: 'private', visible_user_ids: ['ops', 'setter'], user_id: 'owner', production_job_id: null })
    const dealFull = { ...dealRow, address_text: null, status: null, closer_user_ids: [], extra_user_ids: [] }
    const seen = async (v: ThreadViewer) => (await getTimeline(db.client as never, v, dealFull as never)).messages.map((m) => m.body)
    expect(await seen(W.owner)).toEqual(['Customer is in a dispute'])
    expect(await seen(W.ops)).toEqual(['Customer is in a dispute'])
    expect(await seen(W.setter)).toEqual(['Customer is in a dispute']) // listed field role
    expect(await seen(W.closer)).toEqual([]) // the deal's own closer, not listed
    // the old Activity cards use the same rule
    const rows = [{ id: 'a', opportunity_id: 'd1', audience: 'private', restricted_pricing: false, user_id: 'owner', visible_user_ids: ['ops'] }]
    expect(await visibleActivities(db.client as never, { id: 'closer', org_id: ORG, role: 'closer' }, rows as never)).toEqual([])
  })

  it('refuses a non-owner (and a reply to a private note by a non-owner)', async () => {
    const db = fresh()
    for (const who of ['ops', 'closer', 'setter'] as const) {
      const r = await post(db, who, { body: 'sneaky', audience: 'private', visibleUserIds: [] })
      expect(r.ok).toBe(false)
      expect(!r.ok && r.status).toBe(403)
    }
    const p = await post(db, 'owner', { body: 'secret', audience: 'private', visibleUserIds: ['ops'] })
    if (!p.ok) throw new Error('x')
    const reply = await post(db, 'ops', { body: 'ok', replyToId: p.message.id })
    expect(reply.ok).toBe(false)
    expect(!reply.ok && reply.status).toBe(403)
    expect(db.tables.activities).toHaveLength(1)
  })

  it('refuses picked people from another company, inactive people and unknown ids', async () => {
    const db = fresh()
    for (const bad of ['alien', 'gone', 'nobody']) {
      const r = await post(db, 'owner', { body: 'secret', audience: 'private', visibleUserIds: ['ops', bad] })
      expect(r.ok).toBe(false)
      expect(!r.ok && r.status).toBe(400)
    }
    expect(db.tables.activities).toHaveLength(0)
  })

  it('an owner\'s reply to a private note stays private with the same readers', async () => {
    const db = fresh()
    const p = await post(db, 'owner', { body: 'secret', audience: 'private', visibleUserIds: ['ops'] })
    if (!p.ok) throw new Error('x')
    const reply = await post(db, 'owner', { body: 'more', replyToId: p.message.id })
    expect(reply.ok && reply.message.audience).toBe('private')
    expect(reply.ok && reply.message.visible_user_ids).toEqual(['ops'])
  })

  it('a logged contact cannot be private', async () => {
    const db = fresh()
    const r = await post(db, 'owner', { body: 'x', audience: 'private', contact: { kind: 'call', outcome: 'reached' } })
    expect(r.ok).toBe(false)
  })

  it('an @mention only notifies people who can read it; an unlisted person gets no ping at all', async () => {
    const db = fresh()
    const r = await post(db, 'owner', { body: 'Hey @Person ops and @Person closer please look', audience: 'private', visibleUserIds: ['ops'] })
    if (!r.ok) throw new Error(String(r.error))
    expect(r.recipients.map((x) => x.userId)).toEqual(['ops'])
    expect(r.blindMentions).toEqual([])
  })

  it('a non-private note keeps no list', async () => {
    const db = fresh()
    const r = await post(db, 'owner', { body: 'hello', audience: 'team', visibleUserIds: ['ops'] })
    const row = db.tables.activities.find((a) => r.ok && a.id === r.message.id)
    expect(row?.visible_user_ids).toBeUndefined()
  })
})

describe('private notes never reach customers or crews', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8')
  it('the portal and crew readers are allow-lists that never name the private audience', () => {
    expect(read('lib/threads/portal-thread.ts')).toContain(".eq('audience', 'customer')")
    expect(read('lib/threads/portal-thread.ts')).not.toContain('private')
    expect(read('lib/threads/crew-notes.ts')).toContain(".eq('audience', 'crew')")
    expect(read('lib/threads/job-notes.ts')).toContain("['production', 'crew']")
  })
  it('the AI connector thread tool and the catch-up summary leave private notes out', () => {
    expect(read('lib/ai-connector/tools/thread.ts')).toContain("m.audience !== 'private'")
    expect(read('lib/job-catch-up-db.ts')).toContain("r.audience !== 'private'")
  })
})

describe('private notes: deploy-order fallback (column not there yet)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { selectWithVisibleCol, withoutVisibleCol } = require('@/lib/threads/private-columns') as typeof import('@/lib/threads/private-columns')
  const { loadMessage } = require('@/lib/threads/post-message') as typeof import('@/lib/threads/post-message')
  const missing = { code: '42703', message: 'column activities.visible_user_ids does not exist' }

  it('re-runs the same select without the column on a missing-column error, and only then', async () => {
    const seen: string[] = []
    const r = await selectWithVisibleCol('id, audience, visible_user_ids, body', async (cols) => {
      seen.push(cols)
      return cols.includes('visible_user_ids') ? { data: null, error: missing } : { data: [{ id: 1 }], error: null }
    })
    expect(seen).toEqual(['id, audience, visible_user_ids, body', 'id, audience, body'])
    expect(r.data).toEqual([{ id: 1 }])
    // another error is returned untouched, no second try
    const other = { code: '57014', message: 'timeout' }
    const calls: string[] = []
    const r2 = await selectWithVisibleCol('id, visible_user_ids', async (cols) => { calls.push(cols); return { data: null, error: other } })
    expect(calls).toHaveLength(1)
    expect(r2.error).toBe(other)
    expect(withoutVisibleCol('a, visible_user_ids, users(full_name)')).toBe('a, users(full_name)')
  })

  it('a note just written still loads (postMessage never fails after writing) when the column is missing', async () => {
    const row = { id: 'n1', user_id: 'owner', type: 'note', body: 'hi', created_at: '2026-12-01T00:00:00Z', audience: 'team', origin: 'human', priority: 'fyi', restricted_pricing: false, reply_to_id: null, mentioned_user_ids: [], pinned_at: null, pin_scope: null, pin_expires_at: null, edited_at: null, deleted_at: null, deleted_user_name: null, users: { full_name: 'A' } }
    const chain = (cols: string): unknown => {
      const c: Record<string, unknown> = {}
      for (const k of ['eq']) c[k] = () => c
      c.maybeSingle = async () => (cols.includes('visible_user_ids') ? { data: null, error: missing } : { data: row, error: null })
      return c
    }
    const admin = { from: () => ({ select: (cols: string) => chain(cols) }) }
    const m = await loadMessage(admin as never, 'org1', 'n1')
    expect(m).toMatchObject({ id: 'n1', audience: 'team', visible_user_ids: [] })
  })
})

describe('private notes: replies and notifications', () => {
  const ORG = 'org1'
  const mkv = (o: Partial<ThreadViewer> & { userId: string }): ThreadViewer => ({ ...base, orgId: ORG, ...o })
  const owner = mkv({ userId: 'owner', ownerLike: true, jobBoard: true, jobEdit: true })
  const mkUser = (id: string, role: string) => ({ id, full_name: `Person ${id}`, email: `${id}@x.com`, active: true, role, custom_role_id: null, is_super_admin: id === 'owner', org_id: ORG })
  const dealRow = { id: 'd1', owner_user_id: 'closer', setter_user_id: 'setter', customer_id: 'c1', lead_id: null }
  const fresh = () => createFakeDb({ users: [mkUser('owner', 'admin'), mkUser('ops', 'operations'), mkUser('setter', 'setter')], opportunities: [{ org_id: ORG, ...dealRow }], activities: [], threads: [], thread_members: [] })
  const send = (db: ReturnType<typeof fresh>, draft: Record<string, unknown>) =>
    postMessage(db.client as never, { id: 'owner', org_id: ORG, role: 'x' }, dealRow, { body: 'x', ...draft } as never, { viewer: owner, resolveViewer: (async (u: { id: string }) => mkv({ userId: u.id })) as never })

  it('a reply to a private note always keeps the parent\'s readers, whatever the draft says', async () => {
    const db = fresh()
    const p = await send(db, { body: 'secret', audience: 'private', visibleUserIds: ['ops'] })
    if (!p.ok) throw new Error('x')
    const r = await send(db, { body: 'more', replyToId: p.message.id, visibleUserIds: ['setter'] })
    expect(r.ok && r.message.visible_user_ids).toEqual(['ops'])
    const r2 = await send(db, { body: 'again', replyToId: p.message.id, visibleUserIds: [] })
    expect(r2.ok && r2.message.visible_user_ids).toEqual(['ops'])
  })

  it('notifications for a private note carry no body: not in the bell, not in push, not in email', async () => {
    jest.resetModules()
    const push = jest.fn()
    const sendMail = jest.fn(async () => undefined)
    jest.doMock('@/lib/push-apns', () => ({ sendPushToUserBackground: push }))
    jest.doMock('@/lib/setter-email', () => ({ getMailTransport: () => ({ sendMail }) }))
    jest.doMock('@/lib/crm-email-from', () => ({ getCrmEmailFrom: async () => 'from@x.com' }))
    jest.doMock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://app.test' }))
    process.env.SMTP_HOST = 'smtp.test'
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { notifyMessage } = require('@/lib/threads/notify') as typeof import('@/lib/threads/notify')
    const inserted: Array<Record<string, unknown>> = []
    const admin = {
      from: (t: string) => t === 'notifications'
        ? { insert: async (rows: Array<Record<string, unknown>>) => { inserted.push(...rows); return { error: null } } }
        : { select: () => ({ in: async () => ({ data: [{ id: 'ops', email: 'ops@x.com', full_name: 'Ops' }] }) }) },
    }
    const secret = 'The customer is suing, do not mention it'
    await notifyMessage(admin as never, {
      orgId: ORG, senderId: 'owner', senderName: 'Nathan', deal: { id: 'd1', customerId: 'c1', leadId: null, label: '12 Oak St' },
      message: { id: 'm1', body: secret, audience: 'private' } as never,
      recipients: [{ userId: 'ops', priority: 'needs_reply', reason: 'mention' }], blindMentions: [],
    })
    expect(inserted[0].title).toBe('Nathan left you a private note on 12 Oak St')
    const everything = JSON.stringify([inserted, push.mock.calls, sendMail.mock.calls])
    expect(everything).not.toContain('suing')
    expect(everything).toContain('private note on 12 Oak St')
    expect(everything).toContain('/c/c1/d/d1/overview/n/m1') // the link is still there
    jest.dontMock('@/lib/push-apns'); jest.dontMock('@/lib/setter-email'); jest.dontMock('@/lib/crm-email-from'); jest.dontMock('@/lib/company-links')
  })
})
