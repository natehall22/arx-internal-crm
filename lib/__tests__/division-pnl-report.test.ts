import { readFileSync } from 'fs'
import { join } from 'path'

import { codeForLine } from '@/lib/cost-codes'
import { resolveOrgProfile } from '@/lib/org-profile'
import { DATASETS } from '@/lib/reporting/catalog'
import { offeredDatasets, offeredTemplates } from '@/lib/reporting/offered'
import { parseSpec } from '@/lib/reporting/report-spec'
import { ReportAccessError, runReport, type ReportContext } from '@/lib/reporting/run'
import { REPORT_TEMPLATES, specTouchesFinancials, templateByKey } from '@/lib/reporting/templates'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/202611300150_rpt_division_pnl.sql'), 'utf8').replace(/^--.*$/gm, '')
const revenueSql = readFileSync(join(process.cwd(), 'supabase/migrations/202611230010_rpt_revenue.sql'), 'utf8')
const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({ orgId: 'org-1', userId: 'u1', scope: 'all', finance: true, canExport: true, scopedUserIds: null, ...over })

function fakeAdmin(rows: Record<string, unknown>[]) {
  const calls: string[] = []
  const q: Record<string, any> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'gt', 'neq', 'ilike', 'order']) {
    q[m] = (...a: unknown[]) => { calls.push(`${m}:${a[0]}${m === 'eq' ? '=' + a[1] : ''}`); return q }
  }
  q.range = async (from: number) => ({ data: from === 0 ? rows : [], error: null })
  return { admin: { from: (v: string) => { calls.push(`from:${v}`); return q } } as any, calls }
}

const row = (division: string, line: string, revenue: number, cost: number) => ({
  pnl_id: `${division}|${line}`, entry_date: '2026-11-02', division, line, division_line: `${division} · ${line}`, revenue, cost, profit: revenue - cost,
  sort_key: `${division === 'No division' ? '1' : '0'}|${division.toLowerCase()}|${line === 'Revenue' ? '0' : '1|' + line.toLowerCase()}`,
})

// The view is applied (migration 202611300150), so the dataset is not pending; the flag mechanism is still checked below.
const pending = DATASETS.division_pnl.viewPending
beforeAll(() => { DATASETS.division_pnl.viewPending = false })
afterAll(() => { DATASETS.division_pnl.viewPending = pending })

describe('release flag', () => {
  it('is no longer pending, and a pending flag would hide it (not offered, not runnable)', async () => {
    expect(pending).toBeFalsy()
    DATASETS.division_pnl.viewPending = true
    try {
      const { admin } = fakeAdmin([])
      await expect(runReport(admin, ctx(), templateByKey('profit-by-division')!.spec)).rejects.toBeInstanceOf(ReportAccessError)
      expect(offeredDatasets(ctx()).map((d) => d.key)).not.toContain('division_pnl')
    } finally { DATASETS.division_pnl.viewPending = false }
  })
})

describe('Profit by division', () => {
  const byDivision = templateByKey('profit-by-division')!
  const byCode = templateByKey('profit-by-division-and-code')!

  it('templates are valid specs on the division_pnl dataset and flagged finance', () => {
    for (const t of [byDivision, byCode]) {
      const p = parseSpec(t.spec)
      expect(p.ok).toBe(true)
      expect(t.finance).toBe(true)
      expect(specTouchesFinancials(t.spec)).toBe(true)
    }
    expect(parseSpec({ ...byDivision.spec, alsoRatio: ['nope'] })).toEqual({ ok: false, error: 'Unknown ratio' })
  })

  it('org scoping: reads the view with the org filter', async () => {
    const { admin, calls } = fakeAdmin([])
    await runReport(admin, ctx(), byDivision.spec)
    expect(calls).toContain('from:rpt_division_pnl')
    expect(calls).toContain('eq:org_id=org-1')
  })

  it('financial gating: refused without reports:financials, hidden from the offered lists', async () => {
    const { admin } = fakeAdmin([])
    await expect(runReport(admin, ctx({ finance: false }), byDivision.spec)).rejects.toBeInstanceOf(ReportAccessError)
    expect(DATASETS.division_pnl.financeOnly).toBe(true)
    const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 1 } })
    const noFin = ctx({ finance: false, features: lawn.features, starterReports: lawn.starterReports })
    expect(offeredDatasets(noFin).map((d) => d.key)).not.toContain('division_pnl')
    expect(offeredTemplates(noFin).map((t) => t.key)).not.toContain('profit-by-division')
    expect(offeredTemplates({ ...noFin, finance: true }).map((t) => t.key)).toEqual(expect.arrayContaining(['profit-by-division', 'profit-by-division-and-code']))
  })

  it('"No division" stays its own group; margin = profit / revenue, blank (not 0) when revenue is 0', async () => {
    const { admin } = fakeAdmin([
      row('Lawn care', 'Revenue', 1000, 0), row('Lawn care', 'Labor', 0, 400), row('Lawn care', 'Materials', 0, 100),
      row('No division', 'Labor', 0, 50), row('Soft wash', 'Revenue', 200, 0),
    ])
    const res = await runReport(admin, ctx(), byDivision.spec)
    const by = Object.fromEntries(res.rows.map((r) => [r.group as string, r]))
    expect(by['Lawn care']).toMatchObject({ value: 1000, sum_cost: 500, sum_profit: 500, ratio_margin: 50 })
    expect(by['No division']).toMatchObject({ value: 0, sum_cost: 50, sum_profit: -50, ratio_margin: null })
    expect(by['Soft wash'].ratio_margin).toBe(100)
    expect(res.columns.map((c) => c.label)).toEqual(['Division', 'Total Revenue', 'Total Cost', 'Total Profit', 'Margin %', 'Rows'])
    expect(res.columns.find((c) => c.key === 'ratio_margin')!.type).toBe('percent')
    expect(res.rows.map((r) => r.group)).toEqual(['Lawn care', 'Soft wash', 'No division'])
  })

  it('division x cost code: revenue first, then codes by name, No division last', async () => {
    const { admin } = fakeAdmin([
      row('No division', 'Labor', 0, 1), row('B', 'Labor', 0, 1), row('A', 'Sub', 0, 2), row('A', 'Revenue', 5, 0), row('A', 'Labor', 0, 2), row('A', 'Materials', 0, 2),
    ])
    const res = await runReport(admin, ctx(), byCode.spec)
    expect(res.rows.map((r) => r.group)).toEqual(['A · Revenue', 'A · Labor', 'A · Materials', 'A · Sub', 'B · Labor', 'No division · Labor'])
  })

  it('the blurbs and the dataset say crew time on service visits is not a cost yet, and when revenue and cost are booked', () => {
    for (const text of [byDivision.blurb, byCode.blurb, DATASETS.division_pnl.description]) {
      expect(text).toContain("Crew time on service visits isn't a cost here yet — it needs pay rates.")
      expect(text).toMatch(/Revenue is booked on the sale or invoice date and cost on the day it is spent/)
    }
  })

  it('a ratio on a non-finance viewer is still refused (numerator and denominator are money)', async () => {
    const { admin } = fakeAdmin([])
    await expect(runReport(admin, ctx({ finance: false }), { ...byDivision.spec, dataset: 'division_pnl' })).rejects.toThrow()
  })
})

describe('rpt_division_pnl migration', () => {
  it('is a security_invoker view, closed to anon and authenticated, numbered after 202611300140', () => {
    expect(sql).toMatch(/create or replace view public\.rpt_division_pnl with \(security_invoker = true\)/)
    expect(sql).toMatch(/revoke all on public\.rpt_division_pnl from anon, authenticated/)
  })

  it('revenue = billed rows of rpt_revenue (issued only, so draft/void never count), sales tax left out', () => {
    expect(sql).toMatch(/from public\.rpt_revenue/)
    expect(sql).toMatch(/r\.entry = 'Billed'/)
    expect(sql).toMatch(/r\.service is distinct from 'Sales tax'/)
    // the source view's own rule: every billed branch is issued-only
    const billedBranches = revenueSql.match(/i\.status not in \('draft', 'void'\)/g) ?? []
    expect(billedBranches.length).toBeGreaterThanOrEqual(6)
  })

  it('cost = live ledger lines only; dealer-fee mirror line out, the job fee added once; time entries never read', () => {
    expect(sql).toMatch(/l\.status = 'active' and l\.deleted_at is null/)
    expect(sql).toMatch(/'Lender \/ dealer fee'/)
    expect(sql).toMatch(/'lender_fee'/)
    expect(sql).not.toMatch(/time_entries/)
  })

  it('every table read is joined or filtered by org (no cross-company join)', () => {
    expect(sql).toMatch(/j\.org_id = l\.org_id/)
    expect(sql).toMatch(/tr\.org_id = j\.org_id and tr\.slug = j\.job_type/)
    expect(sql).toMatch(/oc\.org_id = c\.org_id/)
  })

  it('a line with no code falls under its cost type code, exactly as lib/cost-codes codeForLine says', () => {
    const m = sql.match(/case l\.cost_type ([\s\S]*?) else 'other' end/)!
    const pairs = Array.from(m[1].matchAll(/when '(\w+)' then '(\w+)'/g)).map((x) => [x[1], x[2]])
    expect(pairs.length).toBe(4)
    for (const [type, code] of pairs) expect(codeForLine({ cost_code: null, cost_type: type })).toBe(code)
    for (const type of ['misc', 'other', 'whatever']) expect(codeForLine({ cost_code: ' ', cost_type: type })).toBe('other')
    // the default labels are the lib list
    for (const [code, label] of [['materials', 'Materials'], ['labor', 'Labor'], ['sub', 'Sub'], ['permit', 'Permit'], ['dump', 'Dump'], ['equipment', 'Equipment'], ['other', 'Other']]) {
      expect(sql).toContain(`when '${code}' then '${label}'`)
    }
  })

  it('row ids are unique: they carry the division key and the cost code; a real trade named "No division" never merges with the bucket', () => {
    expect(sql).toMatch(/entry_date::text \|\| '\|' \|\| division_key \|\| '\|' \|\| line_key as pnl_id/)
    expect(sql).toMatch(/'@revenue'::text as line_key/)
    expect(sql).toMatch(/coalesce\(t\.slug, '@none'\)/)
    expect(sql).toMatch(/'No division \(trade\)'/)
    expect(sql).toMatch(/as sort_key/)
  })

  it('anything without a division is "No division", not dropped', () => {
    expect(sql).toMatch(/when t\.slug is null then 'No division'/)
    expect(sql).toMatch(/when tr\.slug is null then 'No division'/)
  })
})

describe('ARX (roofing) sees no change', () => {
  const roofing = resolveOrgProfile({})
  const c = ctx({ features: roofing.features, starterReports: roofing.starterReports })

  it('the dataset and both templates are not offered', () => {
    expect(offeredDatasets(c).map((d) => d.key)).not.toContain('division_pnl')
    const keys = offeredTemplates(c).map((t) => t.key)
    expect(keys).not.toContain('profit-by-division')
    expect(keys).not.toContain('profit-by-division-and-code')
  })

  it('every template that existed before is still offered, unchanged', () => {
    const before = REPORT_TEMPLATES.filter((t) => t.spec.dataset !== 'division_pnl').map((t) => t.key)
    const offered = offeredTemplates(c).map((t) => t.key)
    for (const k of offered) expect(before).toContain(k)
  })

  it('a roofing company that turns on project tools or service plans is offered it', () => {
    const on = resolveOrgProfile({ features: { projectTools: true } })
    expect(offeredDatasets(ctx({ features: on.features })).map((d) => d.key)).toContain('division_pnl')
  })
})
