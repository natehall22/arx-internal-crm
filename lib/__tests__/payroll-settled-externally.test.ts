import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { materializePayrollPeriod, planPayrollPeriod } from '@/lib/payroll-period-materialization'

/** Jobs settled outside the CRM before cutover must never reach the payroll calculation, preview or payment. */
const ORG = 'org1'
const job = (id: string, n: string, extra: Record<string, unknown> = {}) => ({ id, org_id: ORG, job_number: n, status: 'complete', address_text: n, sale_date: '2026-10-05', sale_amount: 20000, commission_comp_base: 20000, commission_pre_tax_subtotal: 20000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: `pr-${id}`, completed_at: '2026-10-10T15:00:00Z', ...extra })
const seed = () => ({
  payroll_periods: [{ id: 'p1', org_id: ORG, status: 'open', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23' }],
  production_jobs: [job('j1', '26-0001', { payroll_settled_externally_at: '2026-10-25T00:00:00Z', settled_externally_reason: 'paid outside CRM before cutover' }), job('j2', '26-0002')],
  job_payments: ['j1', 'j2'].map((id) => ({ job_id: id, amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' })),
  projects: [{ id: 'pr-j1', org_id: ORG, opportunity_id: 'o1' }, { id: 'pr-j2', org_id: ORG, opportunity_id: 'o2' }],
  opportunities: ['o1', 'o2'].map((id) => ({ id, org_id: ORG, owner_user_id: 'c1', setter_user_id: null })),
  users: [{ id: 'c1', org_id: ORG, full_name: 'Jordan', role: 'sales_rep', active: true }],
  comp_plans: [{ id: 'plan-closer', name: 'Closer', plan_type: 'percentage', base_percentage: 7, is_active: true, org_id: ORG }],
  user_comp_plans: [{ user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null }],
})
const relations = { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } }

it('plan, preview waiting list and Approve never include a job settled externally', async () => {
  const db = createFakeDb(seed(), { relations })
  const plan = await planPayrollPeriod(db.client, { orgId: 'org1', periodId: 'p1', includeWaiting: true })
  expect(plan.jobs.map((j) => j.job.job_number)).toEqual(['26-0002'])
  expect(plan.waiting.map((w) => w.job.job_number)).toEqual([])
  expect(plan.skippedJobs.map((s) => s.jobId)).not.toContain('j1')

  const run = createFakeDb(seed(), { relations })
  const res = await materializePayrollPeriod(run.client, { orgId: 'org1', periodId: 'p1', actorUserId: 'a' })
  expect(res.payoutLinesCreated).toBe(1)
  expect((run.tables.payroll_payout_lines ?? []).every((l) => l.job_id === 'j2')).toBe(true)
})

it('clearing the flag (Unsettle) brings the job back into the plan', async () => {
  const s = seed()
  s.production_jobs[0] = job('j1', '26-0001') as never
  const db = createFakeDb(s, { relations })
  const plan = await planPayrollPeriod(db.client, { orgId: 'org1', periodId: 'p1' })
  expect(plan.jobs.map((j) => j.job.job_number).sort()).toEqual(['26-0001', '26-0002'])
})
