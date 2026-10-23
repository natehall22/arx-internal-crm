/** @jest-environment node */
import { loadActiveCompPlanForUser } from '@/lib/payroll-export'
import { selectDefaultForRole, suggestDefaultPlan, usersMissingPayPlan, type PlanForSuggestion } from '@/lib/comp-plan-defaults'

const D = (role: string, from: string, plan = 'p1') => ({ role, comp_plan_id: plan, effective_from: from })

describe('selectDefaultForRole', () => {
  it('uses only defaults already in effect on the sale date (never restates history)', () => {
    const rows = [D('sales_rep', '2026-10-24')]
    expect(selectDefaultForRole(rows, 'sales_rep', '2026-10-23')).toBeNull()
    expect(selectDefaultForRole(rows, 'sales_rep', '2026-10-24')?.comp_plan_id).toBe('p1')
  })
  it('latest effective default for the role wins; other roles never match', () => {
    const rows = [D('sales_rep', '2026-10-01', 'old'), D('sales_rep', '2026-11-01', 'new'), D('setter', '2026-10-01', 'set')]
    expect(selectDefaultForRole(rows, 'sales_rep', '2026-10-15')?.comp_plan_id).toBe('old')
    expect(selectDefaultForRole(rows, 'sales_rep', '2026-11-02')?.comp_plan_id).toBe('new')
    expect(selectDefaultForRole(rows, 'closer', '2026-11-02')).toBeNull()
    expect(selectDefaultForRole(rows, null, '2026-11-02')).toBeNull()
  })
})

const plan = (over: Partial<PlanForSuggestion>): PlanForSuggestion => ({ id: 'x', name: 'x', is_active: true, base_percentage: 7, applicable_roles: ['sales_rep'], plan_purpose: 'primary', is_manager_plan: false, plan_type: 'percentage', ...over })
describe('suggestDefaultPlan', () => {
  it('suggests the single company-rate plan for the role, including an inactive one', () => {
    expect(suggestDefaultPlan('sales_rep', [plan({ id: 'closer' }), plan({ id: 'mgr', is_manager_plan: true })])?.id).toBe('closer')
    expect(suggestDefaultPlan('setter', [plan({ id: 'setter5', base_percentage: 5, applicable_roles: ['setter'], is_active: false })])?.id).toBe('setter5')
  })
  it('suggests nothing when ambiguous, wrong rate, or the role has no company rate', () => {
    expect(suggestDefaultPlan('sales_rep', [plan({ id: 'a' }), plan({ id: 'b' })])).toBeNull()
    expect(suggestDefaultPlan('sales_rep', [plan({ base_percentage: 6 })])).toBeNull()
    expect(suggestDefaultPlan('admin', [plan({ applicable_roles: ['admin'] })])).toBeNull()
  })
})

describe('usersMissingPayPlan', () => {
  const users = [
    { id: 'a', full_name: 'A', role: 'sales_rep' },
    { id: 'b', full_name: 'B', role: 'admin' },
    { id: 'c', full_name: 'C', role: 'admin' },
    { id: 'd', full_name: 'D', role: 'setter' },
  ]
  it('flags commission roles and credited people who have neither an assignment nor a role default', () => {
    const r = usersMissingPayPlan({ users, assignedUserIds: new Set(['d']), defaultRoles: new Set(), creditedUserIds: new Set(['b']) })
    expect(r.map((u) => u.id)).toEqual(['a', 'b'])
  })
  it('a role default covers the whole role', () => {
    const r = usersMissingPayPlan({ users, assignedUserIds: new Set(), defaultRoles: new Set(['sales_rep', 'setter']), creditedUserIds: new Set() })
    expect(r).toEqual([])
  })
})

/** Fake Supabase for the resolver: per-table canned answers. */
function fakeClient(tables: Record<string, unknown>) {
  const from = (table: string) => {
    const answer = tables[table]
    const result = Array.isArray(answer) ? { data: answer, error: null } : { data: answer ?? null, error: null }
    const q: any = {}
    for (const m of ['select', 'eq', 'lte', 'or', 'order', 'limit']) q[m] = () => q
    q.maybeSingle = async () => result
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
    return q
  }
  return { from } as never
}

describe('loadActiveCompPlanForUser with a role default', () => {
  const closerPlan = { id: 'closer', name: 'Closer', plan_type: 'percentage', base_percentage: 7 }
  const base = { users: { role: 'sales_rep' }, comp_plans: closerPlan, comp_plan_versions: [], org_default_comp_plans: [{ role: 'sales_rep', comp_plan_id: 'closer', effective_from: '2026-10-24' }] }
  it('an explicit assignment always wins over the default', async () => {
    const assigned = { user_id: 'u', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null, comp_plans: { id: 'mine', name: 'Mine' } }
    const r = await loadActiveCompPlanForUser(fakeClient({ ...base, user_comp_plans: assigned }), 'u', 'o', '2026-11-01')
    expect((r?.comp_plans as { id: string }).id).toBe('mine')
  })
  it('no assignment + default in effect → the role default (marked as such)', async () => {
    const r = await loadActiveCompPlanForUser(fakeClient({ ...base, user_comp_plans: null }), 'u', 'o', '2026-11-01')
    expect(r?.source).toBe('org_default')
    expect((r?.comp_plans as { id: string }).id).toBe('closer')
  })
  it('a sale before the default took effect stays unpaid by default (no backdating)', async () => {
    const client = fakeClient({ ...base, user_comp_plans: null, org_default_comp_plans: [] })
    expect(await loadActiveCompPlanForUser(client, 'u', 'o', '2026-10-01')).toBeNull()
  })
  it('a departed (inactive) user is never paid by a default', async () => {
    const r = await loadActiveCompPlanForUser(fakeClient({ ...base, users: { role: 'sales_rep', active: false }, user_comp_plans: null }), 'u', 'o', '2026-11-01')
    expect(r).toBeNull()
  })
  it('an active user still gets the default', async () => {
    const r = await loadActiveCompPlanForUser(fakeClient({ ...base, users: { role: 'sales_rep', active: true }, user_comp_plans: null }), 'u', 'o', '2026-11-01')
    expect(r?.source).toBe('org_default')
  })
  it('a role with no default stays blank', async () => {
    const r = await loadActiveCompPlanForUser(fakeClient({ ...base, users: { role: 'admin' }, user_comp_plans: null }), 'u', 'o', '2026-11-01')
    expect(r).toBeNull()
  })
})
