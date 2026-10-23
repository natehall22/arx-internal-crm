import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { materializePayrollPeriod, planPayrollPeriod } from '@/lib/payroll-period-materialization'

const ORG = 'org1'
const PERIOD = 'p1'

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const closerPlan = { id: 'plan-closer', name: 'Closer', plan_type: 'percentage', base_percentage: 7, is_active: true, org_id: ORG }
  const setterPlan = { id: 'plan-setter', name: 'Setter', plan_type: 'percentage', base_percentage: 5, is_active: true, org_id: ORG }
  return {
    payroll_periods: [{ id: PERIOD, org_id: ORG, status: 'open', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23' }],
    production_jobs: [
      { id: 'j1', org_id: ORG, job_number: '26-0141', status: 'complete', sale_date: '2026-10-05', sale_amount: 20000, commission_comp_base: 20000, commission_pre_tax_subtotal: 20000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z' },
      // not funded yet
      { id: 'j2', org_id: ORG, job_number: '26-0150', status: 'complete', sale_date: '2026-10-06', sale_amount: 21000, commission_comp_base: 21000, commission_pre_tax_subtotal: 21000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr2', completed_at: '2026-10-12T15:00:00Z' },
      // not installed
      { id: 'j3', org_id: ORG, job_number: '26-0152', status: 'scheduled', sale_date: '2026-10-07', sale_amount: 15800, commission_comp_base: 15800, commission_pre_tax_subtotal: 15800, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr3', completed_at: null },
    ],
    job_payments: [
      { job_id: 'j1', amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' },
      { job_id: 'j2', amount_cents: 1680000, funding_status: 'cleared', paid_at: '2026-10-13', created_at: '2026-10-13T12:00:00Z' },
    ],
    projects: [{ id: 'pr1', org_id: ORG, opportunity_id: 'o1' }, { id: 'pr2', org_id: ORG, opportunity_id: 'o2' }, { id: 'pr3', org_id: ORG, opportunity_id: 'o3' }],
    opportunities: ['o1', 'o2', 'o3'].map((id) => ({ id, org_id: ORG, owner_user_id: 'c1', setter_user_id: 's1' })),
    users: [{ id: 'c1', org_id: ORG, role: 'sales_rep', active: true }, { id: 's1', org_id: ORG, role: 'setter', active: true }],
    comp_plans: [closerPlan, setterPlan],
    user_comp_plans: [
      { user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
      { user_id: 's1', org_id: ORG, comp_plan_id: 'plan-setter', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
    ],
    ...extra,
  }
}
const relations = { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } }

const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (['locked_at', 'updated_at', 'created_at'].includes(k) ? undefined : x)))
const writesByTable = (w: ReturnType<typeof createFakeDb>['writes']) => {
  const out: Record<string, unknown[]> = {}
  for (const e of w) (out[`${e.table}:${e.op}`] ??= []).push(...e.rows.map((r) => strip(r)))
  return out
}

describe('planPayrollPeriod is the one calculation', () => {
  it('the preview (plan) equals what Approve pays, line for line', async () => {
    const preview = createFakeDb(seed(), { relations })
    const plan = await planPayrollPeriod(preview.client, { orgId: ORG, periodId: PERIOD, includeWaiting: true })
    expect(preview.writes).toEqual([]) // planning never writes

    const run = createFakeDb(seed(), { relations })
    await materializePayrollPeriod(run.client, { orgId: ORG, periodId: PERIOD, actorUserId: 'admin' })
    const paid = (run.tables.payroll_payout_lines ?? []).map((r) => ({ job: r.job_id, user: r.user_id, role: r.participant_role, gross: r.gross_amount, net: r.net_amount }))
    const planned = plan.jobs.flatMap((j) => j.rows.map((r) => ({ job: r.job_id, user: r.user_id, role: r.participant_role, gross: r.gross_amount, net: r.net_amount })))
    const key = (x: { job: unknown; user: unknown }) => `${x.job}|${x.user}`
    expect(planned.sort((p, q) => key(p).localeCompare(key(q)))).toEqual(paid.sort((p, q) => key(p).localeCompare(key(q))))
    // The known answer: $20,000 base — closer 7% = $1,400, setter 5% = $1,000.
    expect(planned.find((p) => p.user === 'c1')?.net).toBe(1400)
    expect(planned.find((p) => p.user === 's1')?.net).toBe(1000)
  })

  it('jobs that are not payable wait, with plain reasons and the same estimated math', async () => {
    const db = createFakeDb(seed(), { relations })
    const plan = await planPayrollPeriod(db.client, { orgId: ORG, periodId: PERIOD, includeWaiting: true })
    const byJob = Object.fromEntries(plan.waiting.map((w) => [w.job.job_number, w]))
    expect(byJob['26-0150'].reasonText).toBe('Customer still owes $4,200 of $21,000')
    expect(byJob['26-0152'].reasonText).toBe('Install not marked complete')
    // estimated closer line on the unfunded job: 7% of $21,000
    expect(byJob['26-0150'].rows.find((r) => r.user_id === 'c1')?.net_amount).toBe(1470)
  })

  it('a paid period is never planned', async () => {
    const db = createFakeDb({ ...seed(), payroll_periods: [{ id: PERIOD, org_id: ORG, status: 'paid', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23' }] }, { relations })
    await expect(planPayrollPeriod(db.client, { orgId: ORG, periodId: PERIOD })).rejects.toThrow('paid')
  })
})

describe('only finished jobs are ever payable', () => {
  it('a reopened job (in_progress with an install date and full payment) is in Waiting, never in the previewed payable set', async () => {
    const s = seed()
    s.production_jobs[0] = { ...s.production_jobs[0], status: 'in_progress' } as never
    const db = createFakeDb(s, { relations })
    const plan = await planPayrollPeriod(db.client, { orgId: ORG, periodId: PERIOD, includeWaiting: true })
    expect(plan.jobs).toHaveLength(0)
    expect(plan.waiting.find((w) => w.job.job_number === '26-0141')?.reasonText).toBe('Install not marked complete')
    const run = createFakeDb(s, { relations })
    const res = await materializePayrollPeriod(run.client, { orgId: ORG, periodId: PERIOD, actorUserId: 'a' })
    expect(res.payoutLinesCreated).toBe(0)
  })
})
