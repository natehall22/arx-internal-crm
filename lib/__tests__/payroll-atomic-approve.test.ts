jest.mock('@/lib/payroll-statement-email', () => ({ sendPayrollStatementEmail: jest.fn() }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fakePayrollRpcs } from '@/lib/test-helpers/fake-payroll-rpc'
import { addAdjustment } from '@/lib/payroll-adjustments'
import { approvePayWeek } from '@/lib/payroll-approve'
import { loadHourlyRoster } from '@/lib/payroll-hours'
import { isPeriodClaimedError } from '@/lib/payroll-periods'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { planPayrollPeriod } from '@/lib/payroll-period-materialization'
import { mapCommitError } from '@/lib/payroll-period-lock'
import { cutoffYmdEt } from '@/lib/weekly-payroll/cutoff'

/**
 * Approve is one atomic database step (migration 202610280010 + lib/payroll-period-lock.ts). The SQL itself is tested against
 * Postgres (supabase/tests/payroll_atomic_approve.body.sql); here the TypeScript around it, with an in-memory mirror of the RPC
 * that rolls everything back when it throws.
 */
const ORG = 'org1'
const NOW = new Date('2026-10-22T20:00:00Z')

function build(extra: Record<string, Array<Record<string, unknown>>> = {}, rpc = fakePayrollRpcs) {
  const plan = (id: string, pct: number) => ({ id, name: id, plan_type: 'percentage', base_percentage: pct, is_active: true, org_id: ORG })
  return createFakeDb(
    {
      payroll_periods: [],
      production_jobs: [{ id: 'j1', org_id: ORG, job_number: '26-0141', status: 'complete', address_text: '12 Elm St', sale_date: '2026-10-05', sale_amount: 20000, commission_comp_base: 20000, commission_pre_tax_subtotal: 20000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z' }],
      job_payments: [{ job_id: 'j1', amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' }],
      projects: [{ id: 'pr1', org_id: ORG, opportunity_id: 'o1' }],
      opportunities: [{ id: 'o1', org_id: ORG, owner_user_id: 'c1', setter_user_id: 's1' }],
      users: [{ id: 'c1', org_id: ORG, full_name: 'Jordan Vale', role: 'sales_rep', active: true }, { id: 's1', org_id: ORG, full_name: 'Riley Moss', role: 'setter', active: true }],
      comp_plans: [plan('plan-closer', 7), plan('plan-setter', 5)],
      user_comp_plans: [
        { user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
        { user_id: 's1', org_id: ORG, comp_plan_id: 'plan-setter', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
      ],
      ...extra,
    },
    { relations: { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } }, rpc }
  )
}

describe('Approve is all-or-nothing', () => {
  it('a refusal inside the commit leaves NOTHING written, releases the claim and tells the admin to re-review', async () => {
    const db = build({}, {
      ...fakePayrollRpcs,
      // The database refuses the commit (a total that no longer matches): the fake rolls the whole transaction back.
      payroll_commit_week: (args, tables) => {
        fakePayrollRpcs.payroll_commit_week(args, tables)
        throw new Error('payroll_commit:total_mismatch:2400:2401')
      },
    })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const before = JSON.stringify(db.tables.payroll_periods)
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'admin', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409, body: { code: 'changed' } })
    expect(db.tables.payroll_payout_lines ?? []).toHaveLength(0)
    expect(db.tables.payroll_job_snapshots ?? []).toHaveLength(0)
    expect(db.tables.job_payroll_state ?? []).toHaveLength(0)
    expect(db.tables.payroll_unit_earnings ?? []).toHaveLength(0)
    expect(db.tables.payroll_periods[0].status).toBe('open')
    // the claim was released (the week is editable again); nothing else on the period changed
    expect(db.tables.payroll_periods[0].lock_claim_token ?? null).toBeNull()
    expect({ ...db.tables.payroll_periods[0], lock_claim_token: undefined, lock_claimed_at: undefined }).toEqual({ ...JSON.parse(before)[0], lock_claim_token: undefined, lock_claimed_at: undefined })
  })

  it('success reports the total the DATABASE wrote, and the period ends locked with its claim cleared', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'admin', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    expect(res).toMatchObject({ ok: true, total: 2400, people: 2 })
    expect(db.tables.payroll_periods[0]).toMatchObject({ status: 'locked', lock_claim_token: null })
    expect(db.tables.job_payroll_state).toHaveLength(1)
    expect(db.tables.job_payroll_state[0]).toMatchObject({ job_id: 'j1', current_payroll_period_id: week.period.id })
    expect(db.tables.payroll_job_snapshots).toHaveLength(1)
  })

  it('a job that changed after the plan was computed refuses the whole approval', async () => {
    const db = build({}, {
      ...fakePayrollRpcs,
      payroll_commit_week: (args, tables) => {
        ;(tables.production_jobs[0] as Record<string, unknown>).sale_amount = 19000 // edited between compute and commit
        return fakePayrollRpcs.payroll_commit_week(args, tables)
      },
    })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409, body: { code: 'changed' } })
    expect(db.tables.payroll_payout_lines ?? []).toHaveLength(0)
    expect(db.tables.payroll_periods[0].status).toBe('open')
  })

  it('a week whose payable total is $0 still approves when there is a negative balance to carry, and carries it', async () => {
    const db = build({ production_jobs: [] })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const add = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: -300, reason: 'clawback' })
    expect(add.ok).toBe(true)
    const draft = await loadPayWeek(db.client, ORG, NOW)
    expect(draft.totals.amount).toBe(0)
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: 0, now: NOW })
    expect(res.ok).toBe(true)
    const balance = (db.tables.payroll_adjustments ?? []).filter((r) => r.kind === 'balance')
    expect(balance).toHaveLength(1)
    expect(balance[0]).toMatchObject({ user_id: 's1', amount: -300, status: 'pending', source_period_id: week.period.id })
  })

  it('a $0 week with nothing to write or carry is still refused', async () => {
    const db = build({ production_jobs: [] })
    const week = await loadPayWeek(db.client, ORG, NOW)
    expect(await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: 0, now: NOW })).toMatchObject({ ok: false, body: { error: 'Nothing to pay this week' } })
  })

  it('refuses to approve a LATER week while an EARLIER open week still has fixes waiting', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    db.tables.payroll_periods.push({ id: 'earlier', org_id: ORG, status: 'open', cutoff_at: '2026-10-14T03:59:59.999Z', scheduled_pay_date: '2026-10-16', period_label: 'earlier', created_at: '2026-10-01' })
    db.tables.payroll_adjustments = [{ id: 'a1', org_id: ORG, payroll_period_id: 'earlier', user_id: 's1', amount: 50, reason: 'fix', kind: 'fix', status: 'pending' }]
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409, body: { code: 'earlier_week_open' } })
    expect(db.tables.payroll_payout_lines ?? []).toHaveLength(0)
    expect(db.tables.payroll_periods.find((p) => p.id === week.period.id)?.status).toBe('open')
  })
})

describe('Eastern dates (the cutoff is Wednesday night Eastern = already Thursday in UTC)', () => {
  it('cutoffYmdEt is the Eastern calendar date', () => {
    expect(cutoffYmdEt('2026-10-22T03:59:59.999Z')).toBe('2026-10-21')
    expect(cutoffYmdEt('2026-01-08T04:59:59.999Z')).toBe('2026-01-07') // EST
  })

  it('a job sold on the cutoff\'s UTC Thursday (Eastern: after the week) is not in this week\'s plan', async () => {
    const db = build({
      production_jobs: [
        { id: 'j1', org_id: ORG, job_number: 'W', status: 'complete', sale_date: '2026-10-21', sale_amount: 20000, commission_comp_base: 20000, salesperson_id: 'c1', project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z' },
        { id: 'j2', org_id: ORG, job_number: 'T', status: 'complete', sale_date: '2026-10-22', sale_amount: 20000, commission_comp_base: 20000, salesperson_id: 'c1', project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z' },
      ],
      job_payments: ['j1', 'j2'].map((id) => ({ job_id: id, amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' })),
      payroll_periods: [{ id: 'p', org_id: ORG, status: 'open', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23' }],
    })
    const plan = await planPayrollPeriod(db.client, { orgId: ORG, periodId: 'p' })
    expect(plan.jobs.map((j) => j.job.job_number)).toEqual(['W'])
  })
})

describe('hours roster covers everyone who was active any day of the week', () => {
  const seed = (extra: Record<string, Array<Record<string, unknown>>> = {}) =>
    build({
      payroll_periods: [{ id: 'p', org_id: ORG, status: 'open', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23' }],
      users: [
        { id: 'c1', org_id: ORG, full_name: 'Jordan Vale', role: 'sales_rep', active: true },
        { id: 'gone', org_id: ORG, full_name: 'Gone Midweek', role: 'sales_rep', active: false },
        { id: 'never', org_id: ORG, full_name: 'Left Last Month', role: 'sales_rep', active: false },
      ],
      comp_plans: [
        { id: 'plan-hr', name: 'Hourly', plan_type: 'hourly', hourly_rate: 20, is_active: true, org_id: ORG },
        { id: 'plan-closer', name: 'Closer', plan_type: 'percentage', base_percentage: 7, is_active: true, org_id: ORG },
      ],
      user_comp_plans: [
        { user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-hr', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
        // left on Monday of the pay week: deactivation ended the assignment that day
        { user_id: 'gone', org_id: ORG, comp_plan_id: 'plan-hr', effective_from: '2026-01-01', effective_to: '2026-10-19', override_percentage: null, hourly_rate_override: null },
        // ended well before the week
        { user_id: 'never', org_id: ORG, comp_plan_id: 'plan-hr', effective_from: '2026-01-01', effective_to: '2026-09-01', override_percentage: null, hourly_rate_override: null },
      ],
      ...extra,
    })

  it('includes someone who left midweek (inactive today) and not someone who left last month', async () => {
    const db = seed()
    const roster = await loadHourlyRoster(db.client, ORG, { id: 'p', cutoff_at: '2026-10-22T03:59:59.999Z' })
    expect(roster.map((r) => r.user_id).sort()).toEqual(['c1', 'gone'])
    expect(roster.find((r) => r.user_id === 'gone')?.hourly_rate).toBe(20)
  })

  it('always includes anyone with hours already saved, even if inactive with no plan that week', async () => {
    const db = seed({ payroll_rep_hours: [{ org_id: ORG, payroll_period_id: 'p', user_id: 'never', regular_hours: 5, overtime_hours: 0, hourly_rate_snapshot: 20, hourly_earnings: 100, notes: null }] })
    const roster = await loadHourlyRoster(db.client, ORG, { id: 'p', cutoff_at: '2026-10-22T03:59:59.999Z' })
    expect(roster.find((r) => r.user_id === 'never')).toMatchObject({ has_entry: true, hourly_earnings: 100 })
  })
})

describe('per-unit pay is frozen at approval', () => {
  it('an approved week shows the stored per-unit pay and never recalculates it', async () => {
    const db = build({
      payroll_periods: [{ id: 'p', org_id: ORG, status: 'locked', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23', units_frozen_at: '2026-10-23T12:00:00Z' }],
      production_jobs: [],
      // nothing in the live data would produce $75 of per-unit pay: only the stored row can
      payroll_unit_earnings: [{ org_id: ORG, payroll_period_id: 'p', user_id: 'c1', amount: 75, detail: { total: 75 } }],
    })
    const week = await loadPayWeek(db.client, ORG, NOW, 'p')
    expect(week.state).toBe('approved')
    expect(week.totals.amount).toBe(75)
    expect(week.people[0].lines.find((l) => l.kind === 'Units')?.amount).toBe(75)
  })

  it('a week locked before per-unit pay was frozen keeps the old live calculation (no stored rows to trust)', async () => {
    const db = build({
      payroll_periods: [{ id: 'p', org_id: ORG, status: 'locked', cutoff_at: '2026-10-22T03:59:59.999Z', scheduled_pay_date: '2026-10-23' }],
      production_jobs: [],
      payroll_unit_earnings: [{ org_id: ORG, payroll_period_id: 'p', user_id: 'c1', amount: 75 }],
    })
    const week = await loadPayWeek(db.client, ORG, NOW, 'p')
    expect(week.totals.amount).toBe(0) // not read from the table: the legacy path recalculates (no unit plans here)
  })
})

describe('writers refused while a week is being approved', () => {
  it('recognises the database refusal (SQLSTATE 55006 / payroll_period_claimed)', () => {
    expect(isPeriodClaimedError({ code: '55006', message: 'x' })).toBe(true)
    expect(isPeriodClaimedError({ message: 'payroll_period_claimed: this week is being approved right now' })).toBe(true)
    expect(isPeriodClaimedError({ code: '23505', message: 'duplicate' })).toBe(false)
    expect(isPeriodClaimedError(null)).toBe(false)
  })

  it('maps every commit refusal to a plain 409, never a 500 for a known cause', () => {
    for (const [msg, code] of [['payroll_commit:claim_lost', 'lock_in_progress'], ['payroll_commit:earlier_week_open', 'earlier_week_open'], ['payroll_commit:total_mismatch:1:2', 'changed'], ['payroll_commit:job_changed:j', 'changed'], ['payroll_already_paid: job x', 'changed']]) {
      expect(mapCommitError({ message: msg }, 10)).toMatchObject({ ok: false, status: 409, body: { code } })
    }
    expect(mapCommitError({ message: 'boom' }, 10)).toMatchObject({ ok: false, status: 500 })
  })
})
