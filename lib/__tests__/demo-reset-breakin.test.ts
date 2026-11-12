/** @jest-environment node */
/**
 * Break-in test: the demo reset can never touch another company. Two layers prove it: (1) the TypeScript door refuses any
 * company without the database demo flag before any write; (2) the SQL function re-checks the flag itself (see
 * supabase/tests/demo_org.test.sql, which runs against real Postgres). Here the stand-in client emulates `demo_reset_org`
 * as the real one behaves (flag check, then `DELETE ... WHERE org_id = p_org` only) and we look at what survives.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { resetDemoOrg } from '@/lib/demo-reset'
import { runCompanySeed, parseCompanySeedInput, SeedStop, type CompanySeedInput } from '@/lib/company-seed'
import { demoSeedRaw } from '@/lib/demo-company-data'

const DEMO = '11111111-1111-4111-8111-111111111111'
const ARX = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

type Rows = Record<string, Array<Record<string, unknown>>>

function world(over: Partial<Rows> = {}) {
  const rows: Rows = {
    orgs: [
      { id: DEMO, name: 'Gulf Coast Grounds & Exterior', is_demo: true, subdomain: 'demo' },
      { id: ARX, name: 'Real Roofing Co', is_demo: false, subdomain: 'real' },
      { id: OTHER, name: 'Flag Missing Co', subdomain: 'other' },
    ],
    users: [
      { id: 'u-demo-1', org_id: DEMO, email: 'owner@demo.example.com' },
      { id: 'u-demo-2', org_id: DEMO, email: 'lead@demo.example.com' },
      { id: 'u-real-1', org_id: ARX, email: 'boss@real.example' },
      { id: 'u-other-1', org_id: OTHER, email: 'x@other.example' },
    ],
    customers: [
      { id: 'c1', org_id: DEMO },
      { id: 'c2', org_id: DEMO },
      { id: 'c3', org_id: ARX },
      { id: 'c4', org_id: ARX },
      { id: 'c5', org_id: OTHER },
    ],
    production_jobs: [{ id: 'j1', org_id: ARX }, { id: 'j2', org_id: DEMO }],
    ...over,
  }
  const deletedLogins: string[] = []
  const rpcCalls: Array<Record<string, unknown>> = []
  const db = createFakeDb(rows, {
    rpc: {
      // The SQL function, as written: flag first, then org-scoped deletes only.
      demo_reset_org: (args, tables) => {
        rpcCalls.push(args)
        const org = (tables.orgs ?? []).find((o) => o.id === args.p_org)
        if (!org || org.is_demo !== true) return { __error: { message: 'not a demo company: nothing was deleted', code: '42501' } }
        const deleted: Record<string, number> = {}
        for (const t of Object.keys(tables)) {
          if (t === 'orgs') continue
          const before = tables[t].length
          tables[t] = tables[t].filter((r) => r.org_id !== args.p_org)
          if (before !== tables[t].length) deleted[t] = before - tables[t].length
        }
        return { deleted, blocked: {}, passes: 1 }
      },
    },
  })
  const client = db.client as unknown as Record<string, any>
  const baseRpc = client.rpc?.bind(client)
  client.rpc = async (name: string, args: Record<string, unknown>) => {
    const out = await baseRpc(name, args)
    const data = out?.data as { __error?: { message: string; code: string } } | null
    if (data && data.__error) return { data: null, error: data.__error }
    return out
  }
  client.auth = { admin: { deleteUser: async (id: string) => (deletedLogins.push(id), { error: null }), listUsers: async () => ({ data: { users: [] }, error: null }), createUser: async () => ({ data: null, error: { message: 'no' } }) } }
  return { client: client as never, tables: db.tables as Rows, deletedLogins, rpcCalls, writes: db.writes }
}

const demoInput = (): CompanySeedInput => {
  const r = parseCompanySeedInput(demoSeedRaw())
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.input
}

describe('resetDemoOrg', () => {
  it('wipes the demo company and its logins, and nothing of any other company', async () => {
    const w = world()
    const out = await resetDemoOrg(w.client, DEMO)
    expect(out.logins).toBe(2)
    expect(w.deletedLogins.sort()).toEqual(['u-demo-1', 'u-demo-2'])
    expect(w.tables.customers.map((c) => c.id)).toEqual(['c3', 'c4', 'c5'])
    expect(w.tables.users.map((u) => u.id).sort()).toEqual(['u-other-1', 'u-real-1'])
    expect(w.tables.production_jobs.map((j) => j.id)).toEqual(['j1'])
    expect(w.tables.orgs).toHaveLength(3) // the org rows stay
    expect(w.rpcCalls).toEqual([{ p_org: DEMO }]) // only ever the demo company's id
  })

  it.each([ARX, OTHER, '99999999-9999-4999-8999-999999999999'])('refuses company %s (no demo flag / unknown): nothing deleted, no login removed, SQL not even called', async (id) => {
    const w = world()
    const before = JSON.stringify(w.tables)
    await expect(resetDemoOrg(w.client, id)).rejects.toThrow(/not a demo company|no company/)
    expect(JSON.stringify(w.tables)).toBe(before)
    expect(w.deletedLogins).toEqual([])
    expect(w.rpcCalls).toEqual([])
  })

  it('the SQL function refuses by itself even if the TypeScript check were bypassed', async () => {
    const w = world()
    const r = await (w.client as any).rpc('demo_reset_org', { p_org: ARX })
    expect(r.error?.code).toBe('42501')
    expect(w.tables.customers).toHaveLength(5)
  })

  it('stops (and removes no login) when a table could not be emptied', async () => {
    const w = world()
    ;(w.client as any).rpc = async () => ({ data: { deleted: {}, blocked: { time_entries: 'append-only' } }, error: null })
    await expect(resetDemoOrg(w.client, DEMO)).rejects.toThrow(/time_entries/)
    expect(w.deletedLogins).toEqual([])
  })
})

describe('seed:company --demo refusals (before any write)', () => {
  it('--reset without --demo is refused', async () => {
    const w = world()
    const input = { ...demoInput(), demo: false }
    await expect(runCompanySeed(w.client, input, { apply: true, reset: true })).rejects.toThrow(/only exists for the demo company/)
    expect(w.rpcCalls).toEqual([])
  })

  it('a demo run against a company without the flag is refused (by id)', async () => {
    const w = world()
    const input = demoInput()
    await expect(runCompanySeed(w.client, { ...input, org: { ...input.org, id: ARX } }, { apply: true, reset: true })).rejects.toThrow(SeedStop)
    await expect(runCompanySeed(w.client, { ...input, org: { ...input.org, id: ARX } }, { apply: true, reset: true })).rejects.toThrow(/not a demo company/)
    expect(w.rpcCalls).toEqual([])
    expect(w.deletedLogins).toEqual([])
    expect(w.tables.customers).toHaveLength(5)
  })

  it('a demo run whose name matches a real (non-demo) company is refused, never adopted', async () => {
    const w = world()
    const input = demoInput()
    await expect(runCompanySeed(w.client, { ...input, org: { ...input.org, name: 'Real Roofing Co', subdomain: 'brandnew' } }, { apply: true, reset: true })).rejects.toThrow(/already exists/)
    expect(w.rpcCalls).toEqual([])
    expect(w.tables.customers).toHaveLength(5)
  })

  it('the demo company that is already built is not rebuilt without --reset', async () => {
    const w = world()
    await expect(runCompanySeed(w.client, demoInput(), { apply: true })).rejects.toThrow(/already built.*--reset/)
    expect(w.rpcCalls).toEqual([])
    expect(w.tables.customers).toHaveLength(5)
  })

  it('--reset is a dry run by default: it says what it would wipe and wipes nothing', async () => {
    const w = world()
    const report = await runCompanySeed(w.client, demoInput(), { apply: false, reset: true })
    expect(report.lines.join('\n')).toMatch(/would wipe the demo company/)
    expect(w.rpcCalls).toEqual([])
    expect(w.deletedLogins).toEqual([])
    expect(w.tables.customers).toHaveLength(5)
  })
})

describe('demo data apply + dry run', () => {
  it('applyDemoCompany refuses a company without the flag before writing anything', async () => {
    const { applyDemoCompany } = await import('@/lib/demo-company-apply')
    const w = world()
    const before = JSON.stringify(w.tables)
    await expect(applyDemoCompany(w.client, ARX, 'u-real-1', { today: '2026-11-11' })).rejects.toThrow(/not a demo company/)
    await expect(applyDemoCompany(w.client, OTHER, 'u-other-1', { today: '2026-11-11' })).rejects.toThrow(/not a demo company/)
    expect(JSON.stringify(w.tables)).toBe(before)
    expect(w.writes).toEqual([])
  })

  it('the demo seed is a dry run by default: it plans the demo org and the data, and writes nothing', async () => {
    const w = world({ orgs: [{ id: ARX, name: 'Real Roofing Co', is_demo: false, subdomain: 'real' }], users: [], customers: [], production_jobs: [] })
    const report = await runCompanySeed(w.client, demoInput(), { apply: false })
    const text = report.lines.join('\n')
    expect(text).toContain('create DEMO org "Gulf Coast Grounds & Exterior"')
    expect(text).toContain('demo data: would add')
    expect(report.lines.every((l) => l.startsWith('[dry run] '))).toBe(true)
    expect(w.writes).toEqual([])
    expect(w.rpcCalls).toEqual([])
  })
})
