/** @jest-environment node */
/**
 * AI connector break-in suite. Every read tool is called as company B's person with company A's ids (all of A's rows share
 * VICTIM_ID), and as a field role (setter): nothing of A's may be read or returned, and a field role sees no money or production.
 */
import { ATTACKER_ID, BRAVO_ROW_ID, LEAK_PATTERNS, ORG_A, ORG_B, VICTIM_ID, companyTables, createWorld, tablesInCode, type World } from '@/lib/test-helpers/breakin-harness'
import { resolveOpsAccess } from '@/lib/ops-access'
import { capResult } from '@/lib/ai-connector/mcp'
import { approveAiChange, declineAiChange } from '@/lib/ai-connector/changes-review'
import { MCP_TOOLS, READ_TOOLS } from '@/lib/ai-connector/tools'
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
  return { w, ctx: { admin: w.db.client as never, profile, userId: ATTACKER_ID, orgId: ORG_B, grantId: 'g-b', writesAllowed: true, rate: async () => ({ ok: true as const }) } }
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

describe('every read tool is read-only and registered', () => {
  it('lists the expected read tools, all read-only with strict schemas', () => {
    expect(READ_TOOLS.map((t) => t.name).sort()).toEqual(['find_customer', 'find_job', 'get_customer', 'get_job_summary', 'get_thread', 'list_invoices', 'list_reports', 'list_schedule', 'list_visits', 'run_report'])
    for (const t of READ_TOOLS) expect(t.readOnly).toBe(true)
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


/* ---- phase 2: write tools (propose = preview only; B's key, A's ids) ------------------------------------------------- */
const WRITE_ATTACKS: Array<[string, unknown]> = [
  ['add_note', { deal_id: VICTIM_ID, text: 'hello' }],
  ['log_contact', { deal_id: VICTIM_ID, kind: 'call', outcome: 'reached' }],
  ['create_customer', { name: 'ALPHA_SECRET', email: 'alpha_secret@alpha.test', phone: '7045550199' }],
  ['create_lead', { name: 'x', phone: '7045550199', email: 'alpha_secret@alpha.test' }],
  ['reschedule_visit', { visit_id: VICTIM_ID, date: '2030-01-01' }],
  ['add_cost_line', { job_id: VICTIM_ID, description: 'tape', amount: 5 }],
  ['draft_invoice', { customer_id: VICTIM_ID, lines: [{ description: 'x', qty: 1, unit_price: 5 }] }],
  ['draft_invoice', { customer_id: BRAVO_ROW_ID, property_id: VICTIM_ID, lines: [{ description: 'x', qty: 1, unit_price: 5 }] }],
  ['draft_purchase_order', { job_id: VICTIM_ID, vendor_id: VICTIM_ID, lines: [{ description: 'x', quantity: 1 }] }],
  ['draft_purchase_order', { job_id: BRAVO_ROW_ID, vendor_id: VICTIM_ID, lines: [{ description: 'x', quantity: 1 }] }],
]

describe('phase 2: write tools only prepare, and never reach company A', () => {
  it('every write tool is registered, needs writes, and is not read-only; confirm_change only REPORTS (read-only, no key) and nothing the AI can call saves', () => {
    const writes = MCP_TOOLS.filter((t) => !t.readOnly).map((t) => t.name).sort()
    expect(writes).toEqual(['add_cost_line', 'add_note', 'create_customer', 'create_lead', 'draft_invoice', 'draft_purchase_order', 'log_contact', 'reschedule_visit'])
    for (const t of MCP_TOOLS.filter((x) => !x.readOnly)) expect(t.needsWrites).toBe(true)
    expect(byName('confirm_change').readOnly).toBe(true)
    expect(MCP_TOOLS.filter((t) => t.destructive).map((t) => t.name).sort()).toEqual(['reschedule_visit'])
    for (const t of MCP_TOOLS) expect(JSON.stringify(t.inputSchema)).not.toMatch(/confirm_key/)
  })
  it.each(WRITE_ATTACKS)('%s: B with A ids → refused or blind; nothing of A read, nothing written to A', async (name, args) => {
    const { w, ctx } = build('admin')
    const res = await run(byName(name), ctx, args)
    expect(res.text).not.toMatch(/EXCEPTION/)
    // The preview echoes what the AI itself typed (create_* use A's marker values as input): remove those, nothing else may carry a marker.
    let echoed = res.text
    for (const v of Object.values(args as Record<string, unknown>)) if (typeof v === 'string') echoed = echoed.split(v).join('')
    for (const p of LEAK_PATTERNS) expect(echoed).not.toContain(p)
    expect(res.text).not.toContain('"records":[{')
    expect(w.readsOfA).toEqual([])
    // A proposal writes only its own pending row (company B's); never any CRM table.
    expect(w.db.writes.filter((x) => x.table !== 'ai_changes' && x.table !== 'ai_rate_hits')).toEqual([])
    for (const x of w.db.writes) for (const r of x.rows) expect(r.org_id ?? ORG_B).toBe(ORG_B)
  })
  it('without crm:write / the switch every write tool and confirm_change refuses before reading anything', async () => {
    for (const t of MCP_TOOLS.filter((x) => x.needsWrites)) {
      const { w, ctx } = build('admin')
      const res = await run(t, { ...ctx, writesAllowed: false }, t.name === 'confirm_change' ? { change_id: VICTIM_ID } : WRITE_ATTACKS.find(([n]) => n === t.name)![1])
      expect(`${t.name}: ${res.error}`).toBe(`${t.name}: true`)
      expect(w.db.writes).toEqual([])
    }
  })
  it('a change prepared in company A cannot be checked or approved by B (not through the AI tool, not through the person door)', async () => {
    const { w, ctx } = build('admin')
    w.db.tables.ai_changes = [{ id: VICTIM_ID, org_id: ORG_A, user_id: ATTACKER_ID, grant_id: 'g-b', tool: 'add_note', args: {}, args_hash: 'x', preview: {}, preview_hash: 'x', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }]
    const res = await run(byName('confirm_change'), ctx, { change_id: VICTIM_ID })
    expect(res.error).toBe(true)
    await expect(approveAiChange({ ...ctx, writesAllowed: true }, VICTIM_ID)).rejects.toThrow()
    await expect(declineAiChange({ ...ctx, writesAllowed: true }, VICTIM_ID)).rejects.toThrow()
    expect(w.db.tables.ai_changes[0].status).toBe('pending')
  })
})

describe('phase 2: field roles cannot make money / production / customer-record changes', () => {
  it.each(['setter', 'canvasser'])('%s: refused for cost, invoice, order, visit and customer changes', async (role) => {
    const { w, ctx } = build(role)
    for (const [name, args] of [
      ['add_cost_line', { job_id: BRAVO_ROW_ID, description: 'tape', amount: 5 }],
      ['draft_invoice', { customer_id: BRAVO_ROW_ID, lines: [{ description: 'x', qty: 1, unit_price: 5 }] }],
      ['draft_purchase_order', { job_id: BRAVO_ROW_ID, vendor_id: BRAVO_ROW_ID, lines: [{ description: 'x', quantity: 1 }] }],
      ['reschedule_visit', { visit_id: BRAVO_ROW_ID, date: '2030-01-01' }],
      ['create_customer', { name: 'New Person', phone: '7045550123' }],
    ] as Array<[string, unknown]>) {
      const res = await run(byName(name), ctx, args)
      expect(`${name}: ${res.error}`).toBe(`${name}: true`)
    }
    expect(w.db.writes.filter((x) => x.table !== 'ai_changes' && x.table !== 'ai_rate_hits')).toEqual([])
  })
})

describe('phase 2 control: B reaches its own records with the same tools (the attacks above are not passing by being blind)', () => {
  it.each([
    ['add_note', { deal_id: BRAVO_ROW_ID, text: 'hello' }],
    ['log_contact', { deal_id: BRAVO_ROW_ID, kind: 'call', outcome: 'reached' }],
    ['create_customer', { name: 'New Person', phone: '7045550123' }],
    ['create_lead', { name: 'New Person', phone: '7045550123' }],
    ['add_cost_line', { job_id: BRAVO_ROW_ID, description: 'tape', amount: 5 }],
  ] as Array<[string, unknown]>)('%s: B on its own record gets a preview', async (name, args) => {
    const { w, ctx } = build('admin')
    const res = await run(byName(name), ctx, args)
    expect(`${name}: ${res.text.slice(0, 400)}`).toContain('waiting_for_the_person_to_approve_nothing_saved')
    expect(w.db.tables.ai_changes.filter((r) => r.tool === name && r.status === 'pending' && r.org_id === ORG_B)).toHaveLength(1)
  })
})
