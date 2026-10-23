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
    q.maybeSingle = async () => (Array.isArray(answer) ? { data: null, error: null } : result)
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

import { buildDefaultCoverageRows, defaultWindowsForUser, usersWithEndedPlan } from '@/lib/comp-plan-defaults'
import { buildAdditiveParticipantsForJob, type DerivedCommissionContext } from '@/lib/job-derived-commission-lines'

describe('when a default applies (one rule)', () => {
  const D = '2026-10-24'
  const win = (o: Partial<Parameters<typeof defaultWindowsForUser>[0]> = {}) =>
    defaultWindowsForUser({ defaultFrom: D, activeHistory: [], assignmentFromDates: [], activeNow: true, ...o })
  it('open-ended for an active, never-assigned, non-test user', () => {
    expect(win()).toEqual([{ from: D, to: null }])
  })
  it('never for a test account or someone inactive with no history', () => {
    expect(win({ isTestAccount: true })).toEqual([])
    expect(win({ activeNow: false })).toEqual([])
  })
  it('a departed rep is still covered for sales BEFORE they left (pre-departure sale pays)', () => {
    const w = win({ activeNow: false, activeHistory: [{ effectiveFrom: '2026-08-07', isActive: true }, { effectiveFrom: '2026-11-10', isActive: false }] })
    expect(w).toEqual([{ from: D, to: '2026-11-09' }])
  })
  it('left before the default began → never', () => {
    expect(win({ activeNow: false, activeHistory: [{ effectiveFrom: '2026-09-02', isActive: false }] })).toEqual([])
  })
  it('a leave-and-return gives two windows; the gap is not covered', () => {
    const w = win({ activeHistory: [{ effectiveFrom: '2026-08-07', isActive: true }, { effectiveFrom: '2026-11-01', isActive: false }, { effectiveFrom: '2026-12-01', isActive: true }] })
    expect(w).toEqual([{ from: D, to: '2026-10-31' }, { from: '2026-12-01', to: null }])
  })
  it('covered only BEFORE their first assignment (ended on purpose afterwards)', () => {
    expect(win({ assignmentFromDates: ['2026-12-01'] })).toEqual([{ from: D, to: '2026-11-30' }])
    expect(win({ assignmentFromDates: ['2026-09-01'] })).toEqual([]) // assigned before the default existed
  })
})

describe('loadActiveCompPlanForUser default window', () => {
  const base = { users: { role: 'sales_rep', active: true }, comp_plans: { id: 'closer', name: 'Closer', plan_type: 'percentage', base_percentage: 7 }, comp_plan_versions: [], org_default_comp_plans: [{ role: 'sales_rep', comp_plan_id: 'closer', effective_from: '2026-10-24' }], user_payroll_active_history: [] }
  it('a rep assigned from 12-01 is still paid the default for a 11-01 sale (before their first assignment)', async () => {
    const r = await loadActiveCompPlanForUser(fakeClient({ ...base, user_comp_plans: [{ effective_from: '2026-12-01' }] }), 'u', 'o', '2026-11-01')
    expect(r?.source).toBe('org_default')
  })
  it('a sale AFTER an ended assignment gets no default', async () => {
    expect(await loadActiveCompPlanForUser(fakeClient({ ...base, user_comp_plans: [{ effective_from: '2026-10-24' }] }), 'u', 'o', '2026-11-01')).toBeNull()
  })
  it('a pre-departure sale still pays; a post-departure sale does not', async () => {
    const left = { ...base, users: { role: 'sales_rep', active: false }, user_comp_plans: null, user_payroll_active_history: [{ effective_from: '2026-08-07', is_active: true }, { effective_from: '2026-11-10', is_active: false }] }
    expect((await loadActiveCompPlanForUser(fakeClient(left), 'u', 'o', '2026-11-05'))?.source).toBe('org_default')
    expect(await loadActiveCompPlanForUser(fakeClient(left), 'u', 'o', '2026-11-20')).toBeNull()
  })
  it('a test account gets nothing', async () => {
    expect(await loadActiveCompPlanForUser(fakeClient({ ...base, users: { role: 'sales_rep', active: true, is_test_account: true }, user_comp_plans: null }), 'u', 'o', '2026-11-01')).toBeNull()
  })
})

describe('Needs you: ended plans', () => {
  const users = [
    { id: 'n', full_name: 'Nathan', role: 'admin', active: true },
    { id: 'c', full_name: 'Current', role: 'sales_rep', active: true },
    { id: 'g', full_name: 'Gone', role: 'sales_rep', active: false },
    { id: 't', full_name: 'Test', role: 'setter', active: true, isTestAccount: true },
    { id: 'f', full_name: 'Future', role: 'sales_rep', active: true },
    { id: 'x', full_name: 'Never', role: 'sales_rep', active: true },
  ]
  const assignments = [
    { user_id: 'n', effective_from: '2026-04-08', effective_to: '2026-08-19' },
    { user_id: 'c', effective_from: '2026-07-01', effective_to: null },
    { user_id: 'g', effective_from: '2026-01-01', effective_to: '2026-05-01' },
    { user_id: 't', effective_from: '2026-01-01', effective_to: '2026-05-01' },
    { user_id: 'f', effective_from: '2026-01-01', effective_to: '2026-09-01' },
    { user_id: 'f', effective_from: '2026-12-01', effective_to: null },
  ]
  it('lists only active, non-test people with an ended plan and no replacement', () => {
    const r = usersWithEndedPlan({ users, assignments, today: '2026-10-24' })
    expect(r.map((u) => [u.id, u.endedOn])).toEqual([['n', '2026-08-19']])
  })
})

describe('default-plan reps earn the derived lines like assigned reps (13% self-gen deal)', () => {
  const OPP = 'opp-1'
  const defaults = [{ role: 'sales_rep', comp_plan_id: 'closer', effective_from: '2026-10-24' }]
  const users: Array<{ id: string; role: string; active?: boolean | null; isTestAccount?: boolean | null }> = [{ id: 'rep', role: 'sales_rep', active: true }]
  const ctx = (compAssignments: DerivedCommissionContext['compAssignments']): DerivedCommissionContext => ({
    rateHistory: [{ inspectionRatePercent: 1.5, managerOverrideRatePercent: 0, selfGenRatePercent: 6, effectiveFrom: '2026-08-05' }],
    inspectorByOpportunity: new Map([[OPP, 'rep']]),
    managerAssignments: [],
    userActiveHistory: [],
    managementOverlayAssignments: [],
    managementOverlayPlanVersions: [],
    compAssignments,
    selfGenByOpportunity: new Map([[OPP, { isSelfGenerated: true, source: 'manual', ownerUserId: 'rep', setterUserId: null }]]),
  })
  const input = { opportunityId: OPP, setterUserId: null, salespersonId: 'rep', opportunityOwnerUserId: 'rep', saleDate: '2026-10-26', explicit: [] }

  const cov = (extra: Partial<Parameters<typeof buildDefaultCoverageRows>[0]> = {}, u = users) =>
    buildDefaultCoverageRows({ users: u, activeHistoryByUser: new Map(), assignmentFromDatesByUser: new Map(), defaults, ...extra })

  it('same participants, so the same pay: 7% base + 6% self-gen = 13%', () => {
    const assigned = buildAdditiveParticipantsForJob({ ...input, context: ctx([{ userId: 'rep', effectiveFrom: '2026-08-05', effectiveTo: null, isManagerPlan: false }]) })
    const viaDefault = buildAdditiveParticipantsForJob({ ...input, context: ctx(cov()) })
    expect(viaDefault.participants).toEqual(assigned.participants)
    const selfGen = viaDefault.participants.find((p) => p.role === 'self_gen')
    expect(selfGen?.overridePercent).toBe(6)
    expect(7 + (selfGen?.overridePercent ?? 0)).toBe(13)
    expect(viaDefault.participants.length).toBeGreaterThan(1) // inspection line too
  })
  it('no derived lines for a test rep, a rep gone before the default, or after their first assignment', () => {
    expect(cov({}, [{ id: 'rep', role: 'sales_rep', active: true, isTestAccount: true }])).toEqual([])
    expect(cov({}, [{ id: 'rep', role: 'sales_rep', active: false }])).toEqual([])
    expect(cov({ assignmentFromDatesByUser: new Map([['rep', ['2026-09-01']]]) })).toEqual([])
    expect(buildAdditiveParticipantsForJob({ ...input, context: ctx([]) }).participants).toEqual([])
  })
  it('a sale before the default began, or after the rep left, is not covered', () => {
    const rows = cov({ activeHistoryByUser: new Map([['rep', [{ effectiveFrom: '2026-11-10', isActive: false }]]]) })
    expect(rows).toEqual([{ userId: 'rep', effectiveFrom: '2026-10-24', effectiveTo: '2026-11-09', isManagerPlan: false }])
    expect(buildAdditiveParticipantsForJob({ ...input, saleDate: '2026-10-20', context: ctx(rows) }).participants).toEqual([])
    expect(buildAdditiveParticipantsForJob({ ...input, saleDate: '2026-11-12', context: ctx(rows) }).participants).toEqual([])
  })
  it('each default segment carries its own manager-plan flag', () => {
    const rows = cov({ defaults: [{ role: 'sales_rep', comp_plan_id: 'a', effective_from: '2026-10-24', isManagerPlan: false }, { role: 'sales_rep', comp_plan_id: 'b', effective_from: '2027-01-01', isManagerPlan: true }] })
    expect(rows).toEqual([
      { userId: 'rep', effectiveFrom: '2026-10-24', effectiveTo: '2026-12-31', isManagerPlan: false },
      { userId: 'rep', effectiveFrom: '2027-01-01', effectiveTo: null, isManagerPlan: true },
    ])
  })
})
