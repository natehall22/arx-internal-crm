import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

import { DATASETS } from '@/lib/reporting/catalog'
import { INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { offeredTemplates } from '@/lib/reporting/offered'
import { parseSpec } from '@/lib/reporting/report-spec'
import { ReportAccessError, runReport, type ReportContext } from '@/lib/reporting/run'
import { REPORT_TEMPLATES, specTouchesFinancials, templateByKey } from '@/lib/reporting/templates'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
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

describe('Revenue by month / Revenue by service templates', () => {
  const month = templateByKey('revenue-by-month')!
  const service = templateByKey('revenue-by-service')!

  it('are valid specs on the revenue dataset and come out of the parser unchanged', () => {
    for (const t of [month, service]) {
      expect(t).toBeDefined()
      const p = parseSpec(t.spec)
      expect(p.ok).toBe(true)
      if (p.ok) expect(p.spec).toMatchObject({ dataset: 'revenue', mode: 'summary', groupBy: t.spec.groupBy, metric: t.spec.metric, ...(t.spec.alsoSum ? { alsoSum: t.spec.alsoSum } : {}) })
    }
  })

  it('month: billed by month with collected beside it, and each kind of work split out', () => {
    expect(month.spec).toMatchObject({ groupBy: '@month', metric: { kind: 'sum', column: 'billed' } })
    expect(month.spec.alsoSum).toEqual(['collected', 'billed_jobs', 'billed_service', 'collected_jobs', 'collected_service'])
    expect(month.group).toBe('Money')
  })

  it('service: only billed rows, by service, so collected payments never show up as a service', () => {
    expect(service.spec).toMatchObject({ groupBy: 'service', metric: { kind: 'sum', column: 'billed' }, filters: [{ column: 'entry', op: 'eq', value: 'Billed' }] })
  })

  it('are finance-only: the dataset is financeOnly, every money column is sensitive, the templates are flagged and hidden from people without reports:financials', () => {
    expect(DATASETS.revenue.financeOnly).toBe(true)
    expect(DATASETS.revenue.ownerColumn).toBeNull()
    for (const c of DATASETS.revenue.columns) if (c.type === 'money') expect(c.sensitive).toBe(true)
    for (const t of [month, service]) {
      expect(t.finance).toBe(true)
      expect(specTouchesFinancials(t.spec)).toBe(true)
    }
    const keys = (c: ReportContext) => offeredTemplates(c).map((t) => t.key)
    expect(keys(ctx({ finance: true }))).toEqual(expect.arrayContaining(['revenue-by-month', 'revenue-by-service']))
    expect(keys(ctx({ finance: false }))).not.toContain('revenue-by-month')
    expect(keys(ctx({ finance: false }))).not.toContain('revenue-by-service')
  })

  it('a viewer without reports:financials is refused, even with scope all', async () => {
    const { admin, calls } = fakeAdmin([])
    await expect(runReport(admin, ctx({ finance: false }), month.spec)).rejects.toBeInstanceOf(ReportAccessError)
    expect(calls).not.toContain('from:rpt_revenue') // refused before any read
  })

  it('every company copy of the lawn / exterior-cleaning profile keeps offering them (allow-listed starters); roofing offers everything', () => {
    for (const id of ['lawn_landscape', 'exterior_cleaning'] as const) {
      expect(INDUSTRY_PROFILES[id].starterReports).toEqual(expect.arrayContaining(['revenue-by-month', 'revenue-by-service']))
    }
    expect(INDUSTRY_PROFILES.roofing.starterReports).toBeNull()
  })

  it('existing templates are untouched (ARX numbers cannot move): no existing spec gained alsoSum, and the old ones still read the same views', () => {
    const old = REPORT_TEMPLATES.filter((t) => !t.key.startsWith('revenue-'))
    expect(old.length).toBeGreaterThanOrEqual(24)
    for (const t of old) expect(t.spec.alsoSum).toBeUndefined()
    expect(templateByKey('sales-by-month')!.spec).toMatchObject({ dataset: 'sales', metric: { kind: 'sum', column: 'amount' } })
    expect(templateByKey('payments-by-month')!.spec).toMatchObject({ dataset: 'payments', metric: { kind: 'sum', column: 'amount' } })
    for (const k of ['jobs', 'sales', 'payments', 'invoices'] as const) expect(DATASETS[k].view).toBe({ jobs: 'rpt_jobs', sales: 'rpt_sales', payments: 'rpt_payments', invoices: 'rpt_invoices' }[k])
  })
})

describe('alsoSum (more totals beside the main one)', () => {
  it('only for sum, only money / number columns, never the main column, never twice', () => {
    expect(parseSpec({ dataset: 'revenue', metric: { kind: 'sum', column: 'billed' }, alsoSum: ['billed', 'collected', 'collected'] })).toMatchObject({ ok: true, spec: { alsoSum: ['collected'] } })
    expect(parseSpec({ dataset: 'revenue', metric: { kind: 'count' }, alsoSum: ['collected'] })).toMatchObject({ ok: true, spec: expect.not.objectContaining({ alsoSum: expect.anything() }) })
    expect(parseSpec({ dataset: 'revenue', metric: { kind: 'sum', column: 'billed' }, alsoSum: ['customer'] }).ok).toBe(false)
    expect(parseSpec({ dataset: 'revenue', metric: { kind: 'sum', column: 'billed' }, alsoSum: ['nope'] }).ok).toBe(false)
    expect(parseSpec({ dataset: 'revenue', metric: { kind: 'sum', column: 'billed' } })).toMatchObject({ ok: true, spec: expect.not.objectContaining({ alsoSum: expect.anything() }) })
  })

  it('a sensitive extra column needs the permission even when the main column does not (own-scope sale price)', async () => {
    // 'sales.amount' is an own-scope price; an extra money column on any dataset is checked like the main one.
    const spec = { dataset: 'jobs', metric: { kind: 'sum', column: 'sale_amount' }, alsoSum: ['collected'], date: { preset: 'all' } }
    const p = parseSpec(spec)
    if (!p.ok) throw new Error('bad spec')
    expect(specTouchesFinancials(p.spec, 'own')).toBe(true) // collected is financial, sale_amount alone would not be
    const { admin } = fakeAdmin([])
    await expect(runReport(admin, ctx({ finance: false, scope: 'own', scopedUserIds: ['u1'] }), p.spec)).rejects.toBeInstanceOf(ReportAccessError)
  })

  it('runs: groups by month and totals billed + the extra columns, each its own column, in order', async () => {
    const rows = [
      { revenue_id: 'a', event_date: '2026-03-10', billed: 10000, collected: 0, billed_jobs: 10000, billed_service: 0, collected_jobs: 0, collected_service: 0 },
      { revenue_id: 'b', event_date: '2026-03-12', billed: 0, collected: 5000, billed_jobs: 0, billed_service: 0, collected_jobs: 5000, collected_service: 0 },
      { revenue_id: 'c', event_date: '2026-03-16', billed: 60, collected: 0, billed_jobs: 0, billed_service: 60, collected_jobs: 0, collected_service: 0 },
      { revenue_id: 'd', event_date: '2026-04-02', billed: 0, collected: -10, billed_jobs: 0, billed_service: 0, collected_jobs: 0, collected_service: -10 },
    ]
    const { admin, calls } = fakeAdmin(rows)
    const r = await runReport(admin, ctx(), { ...templateByKey('revenue-by-month')!.spec, date: { preset: 'all' } })
    expect(calls).toContain('from:rpt_revenue')
    expect(calls).toContain('eq:org_id=org-1')
    expect(r.columns.map((c) => c.key)).toEqual(['group', 'value', 'sum_collected', 'sum_billed_jobs', 'sum_billed_service', 'sum_collected_jobs', 'sum_collected_service', 'rows'])
    expect(r.columns.slice(1, 4).map((c) => c.label)).toEqual(['Total Billed', 'Total Collected', 'Total Billed: jobs'])
    expect(r.rows).toEqual([
      { group: '2026-03', value: 10060, sum_collected: 5000, sum_billed_jobs: 10000, sum_billed_service: 60, sum_collected_jobs: 5000, sum_collected_service: 0, rows: 3 },
      { group: '2026-04', value: 0, sum_collected: -10, sum_billed_jobs: 0, sum_billed_service: 0, sum_collected_jobs: 0, sum_collected_service: -10, rows: 1 },
    ])
    expect(r.summary?.value).toBe(10060)
  })

  it('a report without alsoSum keeps exactly the old result shape', async () => {
    const { admin } = fakeAdmin([{ contract_id: 'a', closer: 'Ann', amount: 100, signed_at: '2026-10-01T00:00:00Z', closer_user_id: 'u1' }])
    const p = parseSpec({ dataset: 'sales', groupBy: 'closer', metric: { kind: 'sum', column: 'amount' }, date: { preset: 'all' } })
    if (!p.ok) throw new Error('bad spec')
    const r = await runReport(admin, ctx(), p.spec)
    expect(r.columns.map((c) => c.key)).toEqual(['group', 'value', 'rows'])
    expect(r.rows).toEqual([{ group: 'Ann', value: 100, rows: 1 }])
  })
})

describe('rpt_revenue SQL: the no-double-count rule, kept in step with the views it must agree with', () => {
  const mig = read('supabase/migrations/202611230010_rpt_revenue.sql')
  const sql = mig.replace(/--.*$/gm, '')
  const jobsView = read('supabase/migrations/202611220010_rpt_jobs_balance_due.sql').replace(/--.*$/gm, '')
  const invView = read('supabase/migrations/202611140010_rpt_invoices.sql').replace(/--.*$/gm, '')

  it('is a security_invoker view, closed to anon / authenticated, additive (no existing view is replaced)', () => {
    expect(sql).toMatch(/create or replace view public\.rpt_revenue with \(security_invoker = true\)/)
    expect(sql).toMatch(/revoke all on public\.rpt_revenue from anon, authenticated/)
    expect(sql.match(/create or replace view/g)).toHaveLength(1)
    expect(sql).not.toMatch(/\b(alter|drop|insert|update|delete)\b/i)
  })

  it('org_id is the first column and rows without a company are dropped', () => {
    expect(sql).toMatch(/select org_id,\s+revenue_id,/)
    expect(sql).toMatch(/where org_id is not null/)
  })

  it('a job is billed by its contract once: the contract branch never reads invoices', () => {
    const first = sql.slice(sql.indexOf("'job:' ||"), sql.indexOf('union all'))
    expect(first).not.toMatch(/job_invoices/)
    expect(first).toMatch(/j\.status <> 'cancelled'/)
    expect(first).toMatch(/billing_mode is distinct from 'time_materials'/)
  })

  it("job invoices add only tax (fixed-price, sale amount > 0) or, for time & materials, their issued total - the same rule as rpt_jobs.balance_due", () => {
    expect(jobsView).toMatch(/j\.billing_mode = 'time_materials'\s+THEN COALESCE\(iv\.issued_total, 0\)/)
    expect(jobsView).toMatch(/WHEN COALESCE\(j\.sale_amount, 0\) > 0 THEN COALESCE\(iv\.issued_tax, 0\)/)
    expect(jobsView).toMatch(/i\.status NOT IN \('draft', 'void'\)/)
    const tax = sql.slice(sql.indexOf("'jobtax:'"), sql.indexOf("'tm:'"))
    expect(tax).toMatch(/i\.tax_cents \/ 100\.0/)
    expect(tax).toMatch(/coalesce\(j\.sale_amount, 0\) > 0/)
    expect(tax).toMatch(/billing_mode is distinct from 'time_materials'/)
    expect(tax).toMatch(/i\.status not in \('draft', 'void'\)/)
    const tm = sql.slice(sql.indexOf("'tm:'"), sql.indexOf("'line:'"))
    expect(tm).toMatch(/i\.total_cents \/ 100\.0/)
    expect(tm).toMatch(/billing_mode = 'time_materials'/)
    expect(tm).toMatch(/i\.status not in \('draft', 'void'\)/)
  })

  it('service billing = invoices with no job, same issued rule and same customer rule as rpt_invoices, never a job invoice', () => {
    expect(invView).toMatch(/where i\.job_id is null\s+and i\.customer_id is not null\s+and i\.status in \('sent', 'partially_paid', 'paid'\)/)
    const svc = sql.slice(sql.indexOf("'line:'"), sql.indexOf("'pay:'"))
    expect(svc.match(/i\.job_id is null and i\.customer_id is not null/g)).toHaveLength(3) // lines, remainder, tax
    expect(svc.match(/i\.status not in \('draft', 'void'\)/g)).toHaveLength(3)
  })

  it('collected = the one job_payments ledger: not pending, refunds (negative rows) kept, invoice_payments never read', () => {
    const pay = sql.slice(sql.indexOf("'pay:'"))
    expect(pay).toMatch(/from public\.job_payments pm/)
    expect(pay).toMatch(/pm\.funding_status is distinct from 'pending'/)
    expect(pay).not.toMatch(/amount_cents\s*[>]/) // no "positive only" filter: refunds net out
    expect(sql).not.toMatch(/invoice_payments/)
    expect(jobsView).toMatch(/pm\.funding_status IS DISTINCT FROM 'pending'/)
  })

  it('the catalog names exactly the view columns', () => {
    const view = sql.slice(sql.lastIndexOf('select org_id,'))
    for (const c of DATASETS.revenue.columns) expect({ col: c.key, inView: new RegExp(`\\b${c.key}\\b`).test(view) }).toEqual({ col: c.key, inView: true })
    expect(DATASETS.revenue.idColumn).toBe('revenue_id')
    expect(DATASETS.revenue.dateColumn).toBe('event_date')
  })
})

// The real SQL against a throwaway Postgres: a job with a contract + deposit/final/tax invoices, a cancelled job, a time & materials job,
// a service visit invoice, a void invoice, a draft, a refund, a pending payment, another company. Needs
//   ALLOW_SCHEMA_RESET=1 PGHOST=/tmp/pg PGPORT=55432 PGUSER=postgres   (the script drops schema public — local throwaway DB only)
const dbReady = process.env.ALLOW_SCHEMA_RESET === '1' && !!process.env.PGHOST
;(dbReady ? describe : describe.skip)('rpt_revenue against real Postgres (supabase/tests/revenue_report.test.sql)', () => {
  it('contract + invoices, service invoice, void, refund: nothing is counted twice', () => {
    const r = spawnSync('bash', ['supabase/tests/run-revenue-report.sh'], { cwd: process.cwd(), encoding: 'utf8', env: process.env })
    expect(r.stderr.split('\n').filter((l) => !/NOTICE|drop cascades/.test(l)).join('\n')).toBe('')
    expect(r.stdout).toContain('PASS revenue_report')
  })
})
