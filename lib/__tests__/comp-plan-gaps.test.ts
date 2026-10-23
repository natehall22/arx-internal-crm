/** @jest-environment node */
import { loadPayPlanGaps } from '@/lib/comp-plan-defaults-db'
import { filterReportForViewer, type DataHealthReport } from '@/lib/data-health'

function fakeAdmin(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? []
      const b: any = {}
      for (const m of ['select', 'eq', 'lte', 'gte', 'not', 'limit', 'order']) b[m] = () => b
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
      return b
    },
  } as never
}

const closerPlan = { id: 'closer', name: 'Closer', is_active: true, base_percentage: 7, applicable_roles: ['sales_rep'], plan_purpose: 'primary', is_manager_plan: false, plan_type: 'percentage' }
const base = {
  users: [
    { id: 'n', full_name: 'Nate', role: 'admin', active: true },
    { id: 'r1', full_name: 'Rep One', role: 'sales_rep', active: true },
    { id: 'r2', full_name: 'Rep Two', role: 'sales_rep', active: true },
    { id: 'e', full_name: 'Evan', role: 'setter', active: true },
    { id: 'x', full_name: 'Gone', role: 'sales_rep', active: false },
    { id: 'b', full_name: 'Becky', role: 'admin', active: true },
  ],
  user_comp_plans: [{ user_id: 'e', effective_from: '2026-07-01', effective_to: null }, { user_id: 'old', effective_from: '2026-01-01', effective_to: '2026-02-01' }],
  org_default_comp_plans: [] as Array<Record<string, unknown>>,
  comp_plans: [closerPlan],
  opportunities: [{ owner_user_id: 'n', setter_user_id: null }],
  production_jobs: [],
}

describe('loadPayPlanGaps', () => {
  it('flags commission-role people and credited admins with no plan; ignores inactive users and uncredited admins', async () => {
    const gaps = await loadPayPlanGaps(fakeAdmin(base), 'org', new Date('2026-10-24T15:00:00Z'))
    const names = gaps.flatMap((g) => g.people.map((p) => p.name)).sort()
    expect(names).toEqual(['Nate', 'Rep One', 'Rep Two'])
    const reps = gaps.find((g) => g.role === 'sales_rep')!
    expect(reps.suggestion).toEqual({ id: 'closer', name: 'Closer', ratePercent: 7 })
  })
  it('a role default clears the whole role', async () => {
    const gaps = await loadPayPlanGaps(fakeAdmin({ ...base, org_default_comp_plans: [{ role: 'sales_rep', effective_from: '2026-10-24' }] }), 'org', new Date('2026-10-24T15:00:00Z'))
    expect(gaps.flatMap((g) => g.people.map((p) => p.name))).toEqual(['Nate'])
  })
})

describe('pay-plan rows in Needs you', () => {
  const report: DataHealthReport = { generatedAt: 'x', jobs: [], appointments: [], payPlans: [{ role: 'sales_rep', roleLabel: 'Closer', people: [{ id: 'a', name: 'A' }], suggestion: null }], count: 1 }
  it('is money: payroll admins see it, others do not', () => {
    expect(filterReportForViewer(report, true).payPlans).toHaveLength(1)
    const hidden = filterReportForViewer(report, false)
    expect(hidden.payPlans).toEqual([])
    expect(hidden.count).toBe(0)
  })
})
