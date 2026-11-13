/** @jest-environment node */
/**
 * Money sweep 2026-11-13 #1: someone credited on a job with no pay plan on the SALE date used to be dropped silently while the others
 * were paid — and once paid the job is snapshotted and never re-planned, so their line could never be added. Now the whole job waits
 * with a plain reason, and the "no pay plan" warning checks the sale date, not today.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { planPayrollPeriod } from '@/lib/payroll-period-materialization'
import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { fakePayrollRpcs } from '@/lib/test-helpers/fake-payroll-rpc'
import { loadPayPlanGaps } from '@/lib/comp-plan-defaults-db'

const ORG = 'org1'
const PERIOD = 'p1'
const relations = { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } }

function seed(closerPlans: Array<{ from: string; to: string | null }>) {
  return {
    payroll_periods: [{ id: PERIOD, org_id: ORG, status: 'open', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23' }],
    production_jobs: [
      { id: 'j1', org_id: ORG, job_number: '26-0043', status: 'complete', sale_date: '2026-09-03', sale_amount: 20000, commission_comp_base: 20000, commission_pre_tax_subtotal: 20000, dealer_fee_amount: 0, salesperson_id: null, project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z', payroll_settled_externally_at: null },
    ],
    job_payments: [{ job_id: 'j1', amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' }],
    projects: [{ id: 'pr1', org_id: ORG, opportunity_id: 'o1' }],
    opportunities: [{ id: 'o1', org_id: ORG, owner_user_id: 'c1', setter_user_id: 's1' }],
    users: [
      { id: 'c1', org_id: ORG, full_name: 'Nathan Hall', role: 'admin', active: true },
      { id: 's1', org_id: ORG, full_name: 'Evan Setter', role: 'setter', active: true },
    ],
    comp_plans: [
      { id: 'plan-closer', org_id: ORG, name: 'Closer', plan_type: 'percentage', base_percentage: 7, is_active: true },
      { id: 'plan-setter', org_id: ORG, name: 'Setter', plan_type: 'percentage', base_percentage: 5, is_active: true },
    ],
    user_comp_plans: [
      ...closerPlans.map((p) => ({ user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: p.from, effective_to: p.to, override_percentage: null, hourly_rate_override: null })),
      { user_id: 's1', org_id: ORG, comp_plan_id: 'plan-setter', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
    ],
    org_default_comp_plans: [],
  }
}

// Nathan's real shape: a plan, a gap over the sale date, then a plan again (covered today).
const GAP = [{ from: '2026-04-08', to: '2026-08-19' }, { from: '2026-10-23', to: null }]

describe('no pay plan on the sale date holds the whole job', () => {
  it('nobody on the job is paid; it waits with the person and the sale date named', async () => {
    const db = createFakeDb(seed(GAP), { relations })
    const plan = await planPayrollPeriod(db.client, { orgId: ORG, periodId: PERIOD, includeWaiting: true })
    expect(plan.jobs).toEqual([])
    expect(plan.waiting).toHaveLength(1)
    expect(plan.waiting[0].reason).toBe('no_pay_plan_on_sale_date')
    expect(plan.waiting[0].reasonText).toBe('Nathan Hall has no pay plan on Sep 3, 2026')
    expect(plan.waiting[0].rows).toEqual([]) // no partial estimate that would understate the job
  })

  it('Approve writes nothing for that job (the setter is not paid alone)', async () => {
    const run = createFakeDb(seed(GAP), { relations, rpc: fakePayrollRpcs })
    await lockPayrollPeriod(run.client, { orgId: ORG, periodId: PERIOD, actorUserId: 'admin', status: 'open' })
    expect(run.tables.payroll_payout_lines ?? []).toEqual([])
    expect(run.tables.payroll_job_snapshots ?? []).toEqual([])
  })

  it('closing the gap pays everyone, unchanged math', async () => {
    const db = createFakeDb(seed([{ from: '2026-04-08', to: null }]), { relations })
    const plan = await planPayrollPeriod(db.client, { orgId: ORG, periodId: PERIOD, includeWaiting: true })
    const lines = plan.jobs.flatMap((j) => j.rows).map((r) => [r.user_id, r.net_amount]).sort()
    expect(lines).toEqual([['c1', 1400], ['s1', 1000]])
  })

  it('a per-job override for that person replaces the plan, so the job is not held', async () => {
    const db = createFakeDb({ ...seed(GAP), deal_commission_roles: [{ org_id: ORG, job_id: 'j1', user_id: 'c1', role: 'closer', override_amount: 500, override_percent: null }] }, { relations })
    const plan = await planPayrollPeriod(db.client, { orgId: ORG, periodId: PERIOD, includeWaiting: true })
    expect(plan.jobs).toHaveLength(1)
  })
})

describe('the "no pay plan" warning reads the sale date', () => {
  const now = new Date('2026-11-13T15:00:00Z')
  it('flags someone covered today but not on the sale date of an unpaid job', async () => {
    const db = createFakeDb(seed(GAP), { relations })
    const gaps = await loadPayPlanGaps(db.client, ORG, now)
    const sale = gaps.filter((g) => g.kind === 'sale_date')
    expect(sale.flatMap((g) => g.people)).toEqual([{ id: 'c1', name: 'Nathan Hall', detail: '26-0043, sold Sep 3, 2026' }])
    expect(sale[0].suggestion).toBeNull()
  })
  it('a paid (snapshotted) job, a cancelled job or a covered sale date raises nothing', async () => {
    const paid = createFakeDb({ ...seed(GAP), payroll_job_snapshots: [{ id: 'snap', org_id: ORG, job_id: 'j1', payroll_period_id: 'old' }] }, { relations })
    expect((await loadPayPlanGaps(paid.client, ORG, now)).filter((g) => g.kind === 'sale_date')).toEqual([])
    const s = seed(GAP)
    const cancelled = createFakeDb({ ...s, production_jobs: s.production_jobs.map((j) => ({ ...j, status: 'cancelled' })) }, { relations })
    expect((await loadPayPlanGaps(cancelled.client, ORG, now)).filter((g) => g.kind === 'sale_date')).toEqual([])
    const covered = createFakeDb(seed([{ from: '2026-04-08', to: null }]), { relations })
    expect((await loadPayPlanGaps(covered.client, ORG, now)).filter((g) => g.kind === 'sale_date')).toEqual([])
  })
})
