import { DATASETS, columnOf } from '@/lib/reporting/catalog'
import { ReportAccessError, checkAccess, resultToCsv, runReport, type ReportContext } from '@/lib/reporting/run'
import { parseSpec } from '@/lib/reporting/report-spec'
import { REPORT_TEMPLATES } from '@/lib/reporting/templates'

const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({
  orgId: 'org-1', userId: 'u1', scope: 'all', finance: false, canExport: true, scopedUserIds: null, ...over,
})

describe('report templates', () => {
  it('every template is a valid spec against the catalog', () => {
    for (const t of REPORT_TEMPLATES) {
      const parsed = parseSpec(t.spec)
      expect({ key: t.key, ok: parsed.ok }).toEqual({ key: t.key, ok: true })
    }
  })

  it('has 15–25+ templates with unique keys', () => {
    expect(REPORT_TEMPLATES.length).toBeGreaterThanOrEqual(15)
    expect(new Set(REPORT_TEMPLATES.map((t) => t.key)).size).toBe(REPORT_TEMPLATES.length)
  })

  it('a template is marked finance exactly when it touches finance-only data', () => {
    for (const t of REPORT_TEMPLATES) {
      const ds = DATASETS[t.spec.dataset]
      const cols = [
        t.spec.groupBy, 'column' in t.spec.metric ? t.spec.metric.column : null, t.spec.sortBy, ...t.spec.filters.map((f) => f.column),
      ].filter(Boolean) as string[]
      const touches = !!ds.financeOnly || cols.some((c) => columnOf(ds, c)?.sensitive)
      expect({ key: t.key, finance: !!t.finance }).toEqual({ key: t.key, finance: touches })
    }
  })
})

describe('role scoping', () => {
  const profit = parseSpec({ dataset: 'jobs', metric: { kind: 'sum', column: 'profit_before_commission' }, groupBy: 'salesperson' })
  const payroll = parseSpec({ dataset: 'payroll_lines', metric: { kind: 'count' } })
  const sales = parseSpec({ dataset: 'sales', metric: { kind: 'sum', column: 'amount' } })

  it('reps cannot see margin or pay', () => {
    if (!profit.ok || !payroll.ok) throw new Error('bad spec')
    expect(() => checkAccess(ctx(), DATASETS.jobs, profit.spec)).toThrow(ReportAccessError)
    expect(() => checkAccess(ctx(), DATASETS.payroll_lines, payroll.spec)).toThrow(ReportAccessError)
  })

  it('finance can', () => {
    if (!profit.ok || !payroll.ok) throw new Error('bad spec')
    expect(() => checkAccess(ctx({ finance: true }), DATASETS.jobs, profit.spec)).not.toThrow()
    expect(() => checkAccess(ctx({ finance: true }), DATASETS.payroll_lines, payroll.spec)).not.toThrow()
  })

  it('payments (money, company-level) need reports:financials', () => {
    const pay = parseSpec({ dataset: 'payments', metric: { kind: 'count' } })
    if (!pay.ok) throw new Error('bad spec')
    expect(() => checkAccess(ctx(), DATASETS.payments, pay.spec)).toThrow(ReportAccessError)
    expect(() => checkAccess(ctx({ finance: true }), DATASETS.payments, pay.spec)).not.toThrow()
  })

  it('a rep sees their OWN sale prices; company-wide dollar totals need reports:financials', () => {
    const count = parseSpec({ dataset: 'sales', metric: { kind: 'count' } })
    if (!count.ok) throw new Error('bad spec')
    expect(() => checkAccess(ctx({ scope: 'own', scopedUserIds: ['u1'] }), DATASETS.sales, count.spec)).not.toThrow()
    if (!sales.ok) throw new Error('bad spec')
    expect(() => checkAccess(ctx({ scope: 'own', scopedUserIds: ['u1'] }), DATASETS.sales, sales.spec)).not.toThrow()
    expect(() => checkAccess(ctx({ scope: 'all' }), DATASETS.sales, sales.spec)).toThrow(ReportAccessError)
    expect(() => checkAccess(ctx({ scope: 'all', finance: true }), DATASETS.sales, sales.spec)).not.toThrow()
  })

  it('every money column is financial, whatever the dataset', () => {
    for (const ds of Object.values(DATASETS)) for (const col of ds.columns) if (col.type === 'money') expect({ ds: ds.key, col: col.key, sensitive: !!col.sensitive }).toEqual({ ds: ds.key, col: col.key, sensitive: true })
  })

  it('rejects unknown columns and datasets', () => {
    expect(parseSpec({ dataset: 'users' }).ok).toBe(false)
    expect(parseSpec({ dataset: 'sales', groupBy: 'password' }).ok).toBe(false)
    expect(parseSpec({ dataset: 'sales', metric: { kind: 'sum', column: 'closer' } }).ok).toBe(false)
  })
})

/** Chainable fake of the supabase query builder that records what the runner asked for. */
function fakeAdmin(rows: Record<string, unknown>[]) {
  const calls: string[] = []
  const q: Record<string, any> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'gt', 'neq', 'ilike', 'order']) {
    q[m] = (...a: unknown[]) => { calls.push(`${m}:${a[0]}${m === 'in' ? '=' + JSON.stringify(a[1]) : m === 'eq' ? '=' + a[1] : ''}`); return q }
  }
  q.range = async (from: number) => ({ data: from === 0 ? rows : [], error: null })
  return { admin: { from: () => q } as any, calls }
}

describe('runReport', () => {
  it('always fences by org and applies the viewer scope', async () => {
    const { admin, calls } = fakeAdmin([])
    const spec = parseSpec({ dataset: 'sales', metric: { kind: 'count' } })
    if (!spec.ok) throw new Error('bad spec')
    await runReport(admin, ctx({ scope: 'own', scopedUserIds: ['u1'] }), spec.spec)
    expect(calls).toContain('eq:org_id=org-1')
    expect(calls).toContain('in:closer_user_id=["u1"]')
  })

  it('totals and groups', async () => {
    const { admin } = fakeAdmin([
      { contract_id: 'a', closer: 'Ann', amount: 100, signed_at: '2026-10-01T00:00:00Z', closer_user_id: 'u1' },
      { contract_id: 'b', closer: 'Ann', amount: 50, signed_at: '2026-10-02T00:00:00Z', closer_user_id: 'u1' },
      { contract_id: 'c', closer: 'Bo', amount: 70, signed_at: '2026-10-03T00:00:00Z', closer_user_id: 'u2' },
    ])
    const spec = parseSpec({ dataset: 'sales', groupBy: 'closer', metric: { kind: 'sum', column: 'amount' }, date: { preset: 'all' } })
    if (!spec.ok) throw new Error('bad spec')
    const r = await runReport(admin, ctx({ finance: true }), spec.spec)
    expect(r.rows.map((x) => [x.group, x.value])).toEqual([['Ann', 150], ['Bo', 70]])
    expect(r.summary?.value).toBe(220)
  })

  it('rate = share of true rows', async () => {
    const { admin } = fakeAdmin([
      { opportunity_id: '1', setter: 'S', is_sold: true, created_at: '2026-10-01', closer_user_id: 'u1' },
      { opportunity_id: '2', setter: 'S', is_sold: false, created_at: '2026-10-01', closer_user_id: 'u1' },
      { opportunity_id: '3', setter: 'S', is_sold: false, created_at: '2026-10-01', closer_user_id: 'u1' },
      { opportunity_id: '4', setter: 'S', is_sold: false, created_at: '2026-10-01', closer_user_id: 'u1' },
    ])
    const spec = parseSpec({ dataset: 'opportunities', groupBy: 'setter', metric: { kind: 'rate', column: 'is_sold' }, date: { preset: 'all' } })
    if (!spec.ok) throw new Error('bad spec')
    const r = await runReport(admin, ctx(), spec.spec)
    expect(r.rows[0]).toMatchObject({ group: 'S', value: 25, rows: 4 })
  })

  it('rows mode never returns finance-only columns to non-finance viewers', async () => {
    const { admin } = fakeAdmin([{ job_id: 'j', job_number: '26-1', status: 'x', sale_date: '2026-10-01', salesperson_id: 'u1', cost_total: 5, profit_before_commission: 9 }])
    const spec = parseSpec({ dataset: 'jobs', mode: 'rows', date: { preset: 'all' } })
    if (!spec.ok) throw new Error('bad spec')
    const r = await runReport(admin, ctx(), spec.spec)
    expect(r.columns.map((c) => c.key)).not.toContain('cost_total')
    expect(r.columns.map((c) => c.key)).not.toContain('profit_before_commission')
    expect(Object.keys(r.rows[0])).not.toContain('cost_total')
  })
})

describe('csv', () => {
  it('neutralises spreadsheet formulas and quotes commas', () => {
    const csv = resultToCsv({
      columns: [{ key: 'a', label: 'A', type: 'text' }], matched: 2, scanned: 2, truncated: false, summary: null,
      rows: [{ a: '=HYPERLINK("x")' }, { a: 'one, two' }],
    })
    expect(csv.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csv.split('\n')[2]).toBe('"one, two"')
  })
})
