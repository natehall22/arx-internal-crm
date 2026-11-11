/** @jest-environment node */
/**
 * AI connector break-in suite. Every read tool is called as company B's person with company A's ids (all of A's rows share
 * VICTIM_ID), and as a field role (setter): nothing of A's may be read or returned, and a field role sees no money or production.
 */
import { ATTACKER_ID, BRAVO_ROW_ID, LEAK_PATTERNS, ORG_A, ORG_B, VICTIM_ID, companyTables, createWorld, tablesInCode, type World } from '@/lib/test-helpers/breakin-harness'
import { resolveOpsAccess } from '@/lib/ops-access'
import { capResult } from '@/lib/ai-connector/mcp'
import { MCP_TOOLS } from '@/lib/ai-connector/tools'
import { ToolError, type McpTool } from '@/lib/ai-connector/tools/types'

let world: World
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => world.db.client }))

const ROOT = process.cwd()
const tables = tablesInCode(ROOT)
const orgTables = companyTables(ROOT)

/** The search SQL function, as the real one behaves: only the company it is asked for. */
const searchRpc = (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
  const kinds = args.p_kinds as string[]
  const out: unknown[] = []
  if (kinds.includes('customer')) for (const r of t.customers ?? []) if (r.org_id === args.p_org) out.push({ kind: 'customer', id: r.id, title: r.name ?? 'c', subtitle: r.phone ?? '', score: 1 })
  if (kinds.includes('job')) for (const r of t.production_jobs ?? []) if (r.org_id === args.p_org) out.push({ kind: 'job', id: r.id, title: r.job_number ?? 'j', subtitle: r.address_text ?? '', score: 1 })
  return { data: out, error: null }
}

function build(role: string) {
  world = createWorld(tables, orgTables, role)
  // createWorld wires no rpc handlers: add the search function (kept scoped to its p_org argument).
  const w = world
  const origRpc = (w.db.client as { rpc: (n: string, a: Record<string, unknown>) => unknown }).rpc
  ;(w.db.client as { rpc: unknown }).rpc = (name: string, args: Record<string, unknown>) => (name === 'search_all' ? Promise.resolve(searchRpc(args, w.db.tables as never)) : origRpc(name, args))
  const profile = w.db.tables.users.find((u) => u.id === ATTACKER_ID) as never
  return { w, ctx: { admin: w.db.client as never, profile, userId: ATTACKER_ID, orgId: ORG_B } }
}

async function run(tool: McpTool, ctx: ReturnType<typeof build>['ctx'], args: unknown): Promise<{ text: string; error: boolean }> {
  try {
    const parsed = tool.schema.parse(args)
    const out = await tool.run(ctx, parsed as never)
    return { text: capResult(out.data), error: false }
  } catch (e) {
    return { text: e instanceof ToolError ? e.message : `EXCEPTION ${String(e)}`, error: true }
  }
}
const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n) as McpTool

const ATTACKS: Array<[string, unknown]> = [
  ['find_customer', { query: 'ALPHA_SECRET' }],
  ['get_customer', { customer_id: VICTIM_ID }],
  ['find_job', { query: 'ALPHA_SECRET' }],
  ['get_job_summary', { job_id: VICTIM_ID }],
  ['list_schedule', { from: '2020-01-01', to: '2030-01-01' }],
  ['list_visits', { from: '2026-11-01', to: '2026-12-01' }],
  ['list_invoices', { job_id: VICTIM_ID }],
  ['list_invoices', { customer_id: VICTIM_ID }],
  ['get_thread', { deal_id: VICTIM_ID }],
  ['list_reports', {}],
]

describe('every phase-1 tool is read-only and registered', () => {
  it('lists the expected tools, all read-only with strict schemas', () => {
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(['find_customer', 'find_job', 'get_customer', 'get_job_summary', 'get_thread', 'list_invoices', 'list_reports', 'list_schedule', 'list_visits', 'run_report'])
    for (const t of MCP_TOOLS) expect(t.readOnly).toBe(true)
  })
})

describe("company B's person with company A's ids", () => {
  it.each(ATTACKS)('%s: nothing of A is read or returned', async (name, args) => {
    const { w, ctx } = build('admin')
    const res = await run(byName(name), ctx, args)
    expect(res.text).not.toMatch(/EXCEPTION/)
    for (const p of LEAK_PATTERNS) expect(res.text).not.toContain(p)
    expect(w.readsOfA).toEqual([])
    expect(w.db.writes).toEqual([])
  })
  it('run_report: every report B is offered runs without touching A', async () => {
    const { w, ctx } = build('admin')
    const list = JSON.parse((await run(byName('list_reports'), ctx, {})).text) as { reports?: Array<{ name: string }> }
    for (const r of (list.reports ?? []).slice(0, 12)) {
      const res = await run(byName('run_report'), ctx, { name: r.name })
      for (const p of LEAK_PATTERNS) expect(res.text).not.toContain(p)
    }
    expect(w.readsOfA).toEqual([])
  })
  it('run_report refuses a free-form or unknown report name', async () => {
    const { ctx } = build('admin')
    expect((await run(byName('run_report'), ctx, { name: 'not_a_report' })).error).toBe(true)
    expect((await run(byName('run_report'), ctx, { name: 'x', spec: { dataset: 'payments' } })).error).toBe(true)
  })
  it('search asks the database about B only', async () => {
    const { w, ctx } = build('admin')
    const seen: unknown[] = []
    const rpc = (w.db.client as { rpc: (n: string, a: Record<string, unknown>) => unknown }).rpc
    ;(w.db.client as { rpc: unknown }).rpc = (n: string, a: Record<string, unknown>) => (seen.push(a.p_org), rpc(n, a))
    await run(byName('find_customer'), ctx, { query: 'Bravo' })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((o) => o === ORG_B)).toBe(true)
    expect(seen).not.toContain(ORG_A)
  })
})

describe('setters and canvassers cannot use find_customer to pull contact details', () => {
  it.each(['setter', 'canvasser'])('%s: no customer that is not their own work is returned', async (role) => {
    const { ctx } = build(role)
    const res = await run(byName('find_customer'), ctx, { query: 'Bravo' })
    const out = JSON.parse(res.text) as { results?: unknown[] }
    expect(out.results ?? []).toEqual([])
  })
})

describe('control: B reaches its own data (the attack tests are not passing by being blind)', () => {
  it('get_job_summary and get_customer find B’s own records', async () => {
    const { w, ctx } = build('admin')
    const job = await run(byName('get_job_summary'), ctx, { job_id: BRAVO_ROW_ID })
    const cust = await run(byName('get_customer'), ctx, { customer_id: BRAVO_ROW_ID })
    expect(job.error).toBe(false)
    expect(cust.error).toBe(false)
    expect(w.readsOfBRecord).toEqual(expect.arrayContaining(['production_jobs', 'customers']))
  })
})

describe('field roles never see money or production through the AI either', () => {
  it.each(['setter', 'canvasser'])('%s: jobs, schedule, visits and invoices are refused, whatever their own job id', async (role) => {
    const { ctx } = build(role)
    for (const [name, args] of [
      ['get_job_summary', { job_id: BRAVO_ROW_ID }],
      ['list_schedule', { from: '2020-01-01', to: '2020-02-01' }],
      ['list_visits', { from: '2026-11-01' }],
      ['list_invoices', { job_id: BRAVO_ROW_ID }],
      ['list_invoices', { customer_id: BRAVO_ROW_ID }],
    ] as Array<[string, unknown]>) {
      const res = await run(byName(name), ctx, args)
      expect(`${name}: ${res.error}`).toBe(`${name}: true`)
      expect(res.text).not.toMatch(/sale_amount|total|balance/i)
    }
  })
  it('a job summary carries no sale amount unless the person may see job money', async () => {
    for (const role of ['operations', 'closer']) {
      const { w, ctx } = build(role)
      const ops = await resolveOpsAccess(w.db.client as never, ATTACKER_ID, ctx.profile)
      const res = await run(byName('get_job_summary'), ctx, { job_id: BRAVO_ROW_ID })
      // The amount is in the answer exactly when the person's own job-money door is open.
      if (!res.error) expect(res.text.includes('sale_amount')).toBe(ops.canViewJobFinancials)
    }
  })
})
