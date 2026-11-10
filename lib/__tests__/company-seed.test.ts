/** @jest-environment node */
import { readFileSync } from 'fs'
import path from 'path'

import { parseCompanySeedInput, runCompanySeed, SeedStop, type CompanySeedInput } from '@/lib/company-seed'
import { DEFAULT_ORG_TRADES, type OrgTrade } from '@/lib/org-trades'
import { planOrgTradesSeed } from '@/lib/org-trades-admin'

const example = JSON.parse(readFileSync(path.join(process.cwd(), 'scripts', 'seed-company.example.json'), 'utf8'))

function parsed(raw: unknown): CompanySeedInput {
  const r = parseCompanySeedInput(raw)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.input
}

describe('parseCompanySeedInput', () => {
  it('accepts the example file', () => {
    const input = parsed(example)
    expect(input.org.id).toBeNull()
    expect(input.trades?.map((t) => t.label)).toEqual(['Landscaping', 'Hardscape', 'Pressure washing', 'Other'])
    expect(input.trades?.[3].matchKeywords).toBeNull()
    expect(input.owner.email).toBe('owner@landscapes.example')
  })

  it('lists every problem at once', () => {
    const r = parseCompanySeedInput({
      org: { id: 'nope', name: ' ', phone: '1', email: 'bad', address: 'x', timezone: 'Mars/Base' },
      brand: { name: 'X', website: 3 },
      trades: [{ label: 'A' }, { label: 'a' }, { label: 'B', matchKeywords: ['('] }],
      owner: {},
    })
    expect(r.ok).toBe(false)
    const errors = r.ok ? [] : r.errors
    for (const bit of ['org.id', 'org.name', 'org.email', 'org.timezone', 'brand.name', 'brand.website', 'listed twice', 'not a valid pattern', 'owner.email', 'owner.fullName']) {
      expect(errors.join('\n')).toContain(bit)
    }
  })

  it('no trades → null (the standard list); an empty list is refused', () => {
    expect(parsed({ ...example, trades: undefined }).trades).toBeNull()
    expect(parseCompanySeedInput({ ...example, trades: [] }).ok).toBe(false)
  })
})

const std = (overrides: Partial<Record<string, Partial<OrgTrade>>> = {}): OrgTrade[] =>
  DEFAULT_ORG_TRADES.map((t) => ({ ...t, ...(overrides[t.slug] ?? {}) }))

describe('planOrgTradesSeed', () => {
  it('standard list only for an org with no rows', () => {
    expect(planOrgTradesSeed([], null).insert.map((t) => t.slug)).toEqual(DEFAULT_ORG_TRADES.map((t) => t.slug))
    expect(planOrgTradesSeed(std(), null)).toEqual({ insert: [], update: [], deactivate: [] })
  })

  it('a landscaping company: its trades added, unwanted standard trades turned off (never deleted), Other kept', () => {
    const plan = planOrgTradesSeed(std(), parsed(example).trades)
    expect(plan.insert.map((t) => [t.slug, t.sort])).toEqual([
      ['landscaping', 10],
      ['hardscape', 20],
      ['pressure_washing', 30],
    ])
    expect(plan.update).toEqual([{ slug: 'other', set: { sort: 40 } }])
    expect(plan.deactivate).toEqual(['roofing', 'gutters', 'siding', 'windows'])
  })

  it('re-run against its own result is a no-op; trades the owner added later are left alone', () => {
    const first = planOrgTradesSeed(std(), parsed(example).trades)
    const after: OrgTrade[] = [
      ...std({ roofing: { active: false }, gutters: { active: false }, siding: { active: false }, windows: { active: false }, other: { sort: 40 } }),
      ...first.insert.map((t) => ({ slug: t.slug, label: t.label, sort: t.sort, active: true, matchKeywords: t.match_keywords })),
      { slug: 'irrigation', label: 'Irrigation', sort: 60, active: true, matchKeywords: null },
    ]
    expect(planOrgTradesSeed(after, parsed(example).trades)).toEqual({ insert: [], update: [], deactivate: [] })
  })
})

/** Minimal read-only Supabase stand-in: rows per table; records every write so a dry run can prove it wrote nothing. */
function fakeClient(tables: Record<string, Record<string, unknown>[]>, authUsers: { id: string; email: string }[] = []) {
  const writes: string[] = []
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = chain
    b.limit = chain
    b.eq = (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), b)
    b.ilike = (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]).toLowerCase() === v.replace(/\\(.)/g, '$1').toLowerCase())), b)
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, count: rows.length, error: null }).then(res)
    for (const w of ['insert', 'update', 'upsert', 'delete']) b[w] = () => (writes.push(`${w} ${table}`), b)
    return b
  }
  const client = {
    from: builder,
    rpc: (fn: string) => (writes.push(`rpc ${fn}`), Promise.resolve({ data: null, error: null })),
    auth: { admin: { listUsers: () => Promise.resolve({ data: { users: authUsers }, error: null }), createUser: () => (writes.push('createUser'), Promise.resolve({})) } },
  }
  return { client: client as never, writes }
}

describe('runCompanySeed (dry run)', () => {
  const input = parsed(example)

  it('a new company: plans every step and writes nothing', async () => {
    const { client, writes } = fakeClient({ orgs: [{ id: 'arx', name: 'ARX Roofing & Exteriors' }], users: [] })
    const report = await runCompanySeed(client, input, { apply: false })
    expect(writes).toEqual([])
    const text = report.lines.join('\n')
    expect(text).toContain('create org "Example Landscapes & Hardscapes"')
    expect(text).toContain('set legalName, set shortName, set website, set serviceArea')
    expect(text).toContain('create login + profile (admin, super admin)')
    expect(text).toContain('create the default permission presets')
    expect(text).toContain('add Landscaping (landscaping)')
    expect(text).toContain('turn off roofing')
    expect(report.lines.every((l) => l.startsWith('[dry run] '))).toBe(true)
  })

  it('refuses a new org whose name another org already has (never adopts someone else’s org by name)', async () => {
    const { client, writes } = fakeClient({ orgs: [{ id: 'other', name: 'example landscapes & hardscapes' }] })
    await expect(runCompanySeed(client, input, { apply: true })).rejects.toThrow(SeedStop)
    expect(writes).toEqual([])
  })

  it('refuses an owner email that belongs to another org, before any write', async () => {
    const { client, writes } = fakeClient({ orgs: [], users: [{ id: 'u1', org_id: 'arx', email: 'owner@landscapes.example' }] })
    await expect(runCompanySeed(client, input, { apply: true })).rejects.toThrow(/another org/)
    expect(writes).toEqual([])
  })

  it('refuses an org that is not this deployment’s DEPLOYMENT_ORG_ID', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const { client, writes } = fakeClient({ orgs: [{ id, name: 'Example Landscapes & Hardscapes' }] })
    await expect(
      runCompanySeed(client, { ...input, org: { ...input.org, id } }, { apply: true, deploymentOrgId: '22222222-2222-4222-8222-222222222222' })
    ).rejects.toThrow(/DEPLOYMENT_ORG_ID/)
    expect(writes).toEqual([])
  })

  const liveId = '33333333-3333-4333-8333-333333333333'
  const liveOrg = (extra: Record<string, Record<string, unknown>[]> = {}) =>
    fakeClient({
      orgs: [{ ...input.org, id: liveId, timezone: null }],
      production_jobs: [{ id: 'j1', org_id: liveId }, { id: 'j2', org_id: liveId }],
      opportunities: [{ id: 'o1', org_id: liveId }],
      customers: [],
      users: [{ id: 'boss', org_id: liveId, email: 'boss@x.example', role: 'admin', is_super_admin: true, active: true }],
      ...extra,
    })

  it('refuses an org already in use (jobs / deals / customers) without --allow-existing, printing the counts', async () => {
    const { client, writes } = liveOrg()
    await expect(runCompanySeed(client, { ...input, org: { ...input.org, id: liveId } }, { apply: true })).rejects.toThrow(
      /in use \(2 production_jobs, 1 opportunities, 0 customers\).*--allow-existing/
    )
    expect(writes).toEqual([])
  })

  it('refuses a second super admin without --add-owner, even with --allow-existing', async () => {
    const { client, writes } = liveOrg()
    await expect(
      runCompanySeed(client, { ...input, org: { ...input.org, id: liveId } }, { apply: true, allowExisting: true })
    ).rejects.toThrow(/already has a super admin \(boss@x.example\).*--add-owner/)
    expect(writes).toEqual([])
  })

  it('with both flags it goes ahead (dry run shows the plan)', async () => {
    const { client, writes } = liveOrg()
    const report = await runCompanySeed(client, { ...input, org: { ...input.org, id: liveId } }, { apply: false, allowExisting: true, addOwner: true })
    expect(writes).toEqual([])
    expect(report.lines.join('\n')).toContain('is in use (2 production_jobs, 1 opportunities, 0 customers)')
    expect(report.lines.join('\n')).toContain('create login + profile (admin, super admin)')
  })

  it('the existing super admin re-running the seed is not "a second owner"', async () => {
    const { client } = liveOrg({ users: [{ id: 'u1', org_id: liveId, email: 'owner@landscapes.example', role: 'admin', is_super_admin: true, active: true }] })
    await expect(runCompanySeed(client, { ...input, org: { ...input.org, id: liveId } }, { apply: false, allowExisting: true })).resolves.toBeTruthy()
  })

  it('an already-seeded org: nothing to do', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const trades = [
      ...std({ roofing: { active: false }, gutters: { active: false }, siding: { active: false }, windows: { active: false }, other: { sort: 40 } }),
      { slug: 'landscaping', label: 'Landscaping', sort: 10, active: true, matchKeywords: ['landscap', 'mulch', 'sod', 'planting'] },
      { slug: 'hardscape', label: 'Hardscape', sort: 20, active: true, matchKeywords: ['hardscap', 'paver', 'retaining wall', 'patio'] },
      { slug: 'pressure_washing', label: 'Pressure washing', sort: 30, active: true, matchKeywords: ['pressure wash', 'power wash'] },
    ].map((t) => ({ org_id: id, slug: t.slug, label: t.label, sort: t.sort, active: t.active, match_keywords: t.matchKeywords }))
    const { client, writes } = fakeClient({
      orgs: [{ ...input.org, id, timezone: null, brand: { legalName: 'Example Landscapes & Hardscapes, LLC', shortName: 'Example', website: 'landscapes.example', serviceArea: 'Anytown, ST' } }],
      users: [{ id: 'u1', org_id: id, email: 'owner@landscapes.example', role: 'admin', is_super_admin: true, active: true }],
      permission_presets: [{ id: 'p', org_id: id }],
      org_trades: trades,
    })
    const report = await runCompanySeed(client, { ...input, org: { ...input.org, id } }, { apply: true })
    expect(writes).toEqual([])
    expect(report.lines).toEqual([
      `org ${id}: columns already match`,
      'brand: already matches',
      'owner owner@landscapes.example: already the super admin',
      'roles: presets already exist',
      'trades: already match',
    ])
  })
})
