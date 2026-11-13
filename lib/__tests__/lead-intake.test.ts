/** @jest-environment node */
/** Lead routing: each mode, the turn pointer, the fallback (a lead is never dropped). */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import {
  parseLeadIntakePatch, parseRoutingPatch, patchUserIds, parseServiceOptions, readLeadIntakeSettings, readRouting, routeLeadCandidates, normalizeService, type LeadRouting,
} from '@/lib/lead-intake'
import { nextInRotation, resolveLeadOwner } from '@/lib/lead-intake-db'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const [A, B, C, D] = [id(1), id(2), id(3), id(4)]

/** JS mirror of SQL lead_routing_next (the real SQL runs in supabase/tests/lead_routing.test.sql). */
const fakeNext = (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
  const users = t.users ?? []
  const eligible = (args.p_user_ids as string[]).filter((u) => users.some((x) => x.id === u && x.org_id === args.p_org_id && x.active === true))
  if (!eligible.length) return null
  const ptrs = (t.lead_routing_pointers ??= [])
  let p = ptrs.find((r) => r.org_id === args.p_org_id && r.scope === args.p_scope)
  if (!p) ptrs.push((p = { org_id: args.p_org_id, scope: args.p_scope, last_user_id: null }))
  const pos = eligible.indexOf(p.last_user_id as string) + 1
  const picked = eligible[pos % eligible.length]
  p.last_user_id = picked
  return picked
}

const dbWith = (extra: Record<string, Array<Record<string, unknown>>> = {}) =>
  createFakeDb(
    {
      users: [
        { id: A, org_id: ORG, active: true, role: 'sales_rep', email: 'a@x.test', created_at: '2026-03-01' },
        { id: B, org_id: ORG, active: true, role: 'sales_rep', email: 'b@x.test', created_at: '2026-03-02' },
        { id: C, org_id: ORG, active: false, role: 'sales_rep', email: 'c@x.test', created_at: '2026-03-03' },
        { id: D, org_id: OTHER, active: true, role: 'sales_rep', email: 'd@x.test', created_at: '2026-03-04' },
        { id: id(9), org_id: ORG, active: true, role: 'admin', email: 'admin@x.test', created_at: '2026-01-01' },
      ],
      ...extra,
    },
    { rpc: { lead_routing_next: fakeNext } }
  )

const settingsOf = (routing: Partial<LeadRouting> & Pick<LeadRouting, 'mode'>, extra: Record<string, unknown> = {}) => ({ leadIntake: routing, ...extra })
const owner = async (db: ReturnType<typeof dbWith>, settings: unknown, source: Parameters<typeof resolveLeadOwner>[3] = null, service: string | null = null, category: string | null = null) =>
  (await resolveLeadOwner(db.client as never, ORG, settings, source, service, category))?.id

describe('person (the default, today\'s behavior)', () => {
  test('nothing stored: source person, then the company lead owner, then the oldest admin', async () => {
    const db = dbWith()
    expect(await owner(db, {}, { id: 's', auto_assign_user_id: B })).toBe(B)
    expect(await owner(db, { web_leads_owner_id: A }, { id: 's', auto_assign_user_id: null })).toBe(A)
    expect(await owner(db, {}, null)).toBe(id(9))
    // never touches the turn pointer
    expect(db.tables.lead_routing_pointers ?? []).toHaveLength(0)
  })
  test('a person from another company or an inactive one is skipped', async () => {
    const db = dbWith()
    expect(await owner(db, { web_leads_owner_id: D }, { id: 's', auto_assign_user_id: C })).toBe(id(9))
  })
})

describe('take turns', () => {
  const rotate = settingsOf({ mode: 'rotate', userIds: [A, B], rules: [] })
  test('hands out A, B, A, B', async () => {
    const db = dbWith()
    const got = []
    for (let i = 0; i < 4; i++) got.push(await owner(db, rotate))
    expect(got).toEqual([A, B, A, B])
  })
  test('skips an inactive or foreign person in the list; nobody eligible → fallback owner', async () => {
    const db = dbWith()
    const got = []
    for (let i = 0; i < 3; i++) got.push(await owner(db, settingsOf({ mode: 'rotate', userIds: [A, C, D], rules: [] })))
    expect(got).toEqual([A, A, A])
    expect(await owner(db, settingsOf({ mode: 'rotate', userIds: [C, D], rules: [] }, { web_leads_owner_id: B }))).toBe(B)
    expect(await owner(db, settingsOf({ mode: 'rotate', userIds: [C], rules: [] }))).toBe(id(9))
  })
  test('a source with its own override keeps its own turn pointer', async () => {
    const db = dbWith()
    const src = { id: 'src1', routing: { mode: 'rotate', userIds: [B, A], rules: [] } }
    expect(await owner(db, rotate, src)).toBe(B)
    expect(await owner(db, rotate)).toBe(A) // company pointer untouched by the source
    expect(await owner(db, rotate, src)).toBe(A)
  })
  test('the turn moves on when the list changes (continues after the last person, or starts over)', async () => {
    const db = dbWith()
    expect(await owner(db, rotate)).toBe(A)
    expect(await owner(db, settingsOf({ mode: 'rotate', userIds: [B, A], rules: [] }))).toBe(B) // after A in [B, A] is B
  })
  test('a failed pointer call never drops the lead: fallback owner', async () => {
    const db = createFakeDb({ users: [{ id: id(9), org_id: ORG, active: true, role: 'admin', email: 'admin@x.test', created_at: '2026-01-01' }] }, { rpc: { lead_routing_next: () => { throw new Error('function does not exist') } } })
    expect(await owner(db as never, settingsOf({ mode: 'rotate', userIds: [A, B], rules: [] }))).toBe(id(9))
  })
  test('the pointer is moved by one SQL call per lead (no read-then-write in app code)', async () => {
    const calls: string[] = []
    const db = createFakeDb({ users: [{ id: A, org_id: ORG, active: true }] }, { rpc: { lead_routing_next: fakeNext }, onRpc: (n) => calls.push(n) })
    await nextInRotation(db.client as never, ORG, 'org:rotate', [A])
    expect(calls).toEqual(['lead_routing_next'])
  })
})

describe('by service', () => {
  const byService = settingsOf(
    { mode: 'service', userIds: [], rules: [{ service: 'Weekly lawn care', userIds: [A] }, { service: 'Pressure washing', userIds: [A, B] }] },
    { web_leads_owner_id: B }
  )
  test('a service maps to one person', async () => {
    const db = dbWith()
    expect(await owner(db, byService, null, 'weekly LAWN-care')).toBe(A)
  })
  test('a service maps to a turn group', async () => {
    const db = dbWith()
    const got = []
    for (let i = 0; i < 3; i++) got.push(await owner(db, byService, null, 'Pressure washing'))
    expect(got).toEqual([A, B, A])
  })
  test('no match, no service, or a person who left → the fallback owner', async () => {
    const db = dbWith()
    expect(await owner(db, byService, null, 'Tree removal')).toBe(B)
    expect(await owner(db, byService, null, null)).toBe(B)
    expect(await owner(db, settingsOf({ mode: 'service', userIds: [], rules: [{ service: 'Mulch', userIds: [C] }] }), null, 'Mulch')).toBe(id(9))
  })
})

describe('by category', () => {
  const byCategory = settingsOf(
    { mode: 'category', userIds: [], rules: [], categoryRules: [{ category: 'commercial', userIds: [A] }, { category: 'new_build', userIds: [A, B] }] },
    { web_leads_owner_id: B }
  )
  test('a category maps to one person (the commercial team works commercial leads)', async () => {
    const db = dbWith()
    expect(await owner(db, byCategory, null, null, 'commercial')).toBe(A)
  })
  test('a category maps to a turn group, with its own turn pointer', async () => {
    const db = dbWith()
    const got = []
    for (let i = 0; i < 3; i++) got.push(await owner(db, byCategory, null, null, 'new_build'))
    expect(got).toEqual([A, B, A])
    expect((db.tables.lead_routing_pointers ?? []).map((p) => p.scope)).toEqual(['org:category:new_build'])
  })
  test('no category, an unlisted category, or a person who left → the same fallback chain as every other mode', async () => {
    const db = dbWith()
    expect(await owner(db, byCategory, null, null, null)).toBe(B)
    expect(await owner(db, byCategory, null, null, 'residential')).toBe(B)
    expect(await owner(db, byCategory, { id: 's', auto_assign_user_id: A }, null, 'residential')).toBe(A) // the source's person comes before the company's
    expect(await owner(db, settingsOf({ mode: 'category', userIds: [], rules: [], categoryRules: [{ category: 'commercial', userIds: [C] }] }), null, null, 'commercial')).toBe(id(9))
  })
  test('the service rules are not consulted in category mode (and vice versa)', async () => {
    const db = dbWith()
    const mixed = settingsOf({ mode: 'category', userIds: [], rules: [{ service: 'Mulch', userIds: [A] }], categoryRules: [{ category: 'commercial', userIds: [B] }] })
    expect(await owner(db, mixed, null, 'Mulch', 'commercial')).toBe(B)
    expect(await owner(db, mixed, null, 'Mulch', null)).toBe(id(9))
  })
  test('a source can carry its own category routing', async () => {
    const db = dbWith()
    const src = { id: 'src1', routing: { mode: 'category', userIds: [], rules: [], categoryRules: [{ category: 'commercial', userIds: [B] }] } }
    expect(await owner(db, settingsOf({ mode: 'person', userIds: [], rules: [], categoryRules: [] }), src, null, 'commercial')).toBe(B)
  })
  test('saving: needs at least one rule with people; slugs only; no duplicates; read leniently', () => {
    expect(parseRoutingPatch({ mode: 'category', categoryRules: [] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'category', categoryRules: [{ category: 'commercial', userIds: [] }] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'category', categoryRules: [{ category: 'Not A Slug', userIds: [A] }] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'category', categoryRules: [{ category: 'commercial', userIds: [A] }, { category: 'commercial', userIds: [B] }] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'category', categoryRules: [{ category: 'commercial', userIds: [A] }] })).toEqual({ routing: { mode: 'category', userIds: [], rules: [], categoryRules: [{ category: 'commercial', userIds: [A] }] } })
    expect(readRouting({ mode: 'category', categoryRules: [{ category: 'commercial', userIds: [A, 'x'] }, { category: 'BAD', userIds: [A] }, { category: 'commercial', userIds: [B] }] })?.categoryRules).toEqual([{ category: 'commercial', userIds: [A] }])
  })
  test('a patch names its category people (company checks them) and per-source default category is validated as a slug', () => {
    const p = parseLeadIntakePatch({ routing: { mode: 'category', categoryRules: [{ category: 'commercial', userIds: [A] }] }, sources: [{ id: '33333333-3333-4333-8333-333333333333', routing: null, defaultCategory: 'commercial' }] })
    if ('error' in p) throw new Error(p.error)
    expect(patchUserIds(p)).toEqual([A])
    expect(p.sources[0].defaultCategory).toBe('commercial')
    expect(parseLeadIntakePatch({ sources: [{ id: '33333333-3333-4333-8333-333333333333', routing: null, defaultCategory: 'Nope!' }] })).toHaveProperty('error')
  })
})

test('routeLeadCandidates: person mode is exactly the old two-person chain', async () => {
  const next = jest.fn()
  expect(await routeLeadCandidates({ routing: { mode: 'person', userIds: [], rules: [], categoryRules: [] }, scopeBase: 'org', service: 'x', sourceUserId: A, fallbackUserId: B }, next)).toEqual([A, B])
  expect(next).not.toHaveBeenCalled()
})

describe('parsing', () => {
  test('settings default to today\'s behavior', () => {
    expect(readLeadIntakeSettings({})).toEqual({ routing: { mode: 'person', userIds: [], rules: [], categoryRules: [] }, reminderEnabled: false, reminderHours: 24 })
    expect(readLeadIntakeSettings(null).reminderHours).toBe(24)
  })
  test('a mode must have what it needs', () => {
    expect(parseRoutingPatch({ mode: 'rotate', userIds: [] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'service', rules: [] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'service', rules: [{ service: 'A', userIds: [] }] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'service', rules: [{ service: 'Lawn care', userIds: [A] }, { service: 'lawn-care', userIds: [B] }] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'rotate', userIds: ['nope'] })).toHaveProperty('error')
    expect(parseRoutingPatch({ mode: 'person' })).toEqual({ routing: { mode: 'person', userIds: [], rules: [], categoryRules: [] } })
  })
  test('stored routing is read leniently', () => {
    expect(readRouting({ mode: 'bogus' })).toBeNull()
    expect(readRouting({ mode: 'rotate', userIds: [A, 'x', A] })).toEqual({ mode: 'rotate', userIds: [A], rules: [], categoryRules: [] })
  })
  test('service names compare ignoring case, spaces and - _ /', () => {
    expect(normalizeService(' Weekly_Lawn-Care ')).toBe('weekly lawn care')
  })
  test('service choices: one per line, no duplicates, limits', () => {
    expect(parseServiceOptions('Lawn care\n\nlawn  care\nMulch')).toEqual({ options: ['Lawn care', 'Mulch'] })
    expect(parseServiceOptions('x'.repeat(61))).toHaveProperty('error')
  })
  test('a screen save: people named anywhere are all listed for the company check', () => {
    const p = parseLeadIntakePatch({ routing: { mode: 'rotate', userIds: [A, B] }, reminder: { enabled: true, hours: 12 }, leadOwnerId: C, sources: [{ id: id(7), routing: { mode: 'rotate', userIds: [D] }, autoAssignUserId: null }] })
    expect('error' in p).toBe(false)
    expect(parseLeadIntakePatch({ reminder: { hours: 0 } })).toHaveProperty('error')
    expect(parseLeadIntakePatch({})).toHaveProperty('error')
  })
})
