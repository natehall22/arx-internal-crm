jest.mock('@/lib/payroll-statement-email', () => ({ sendPayrollStatementEmail: jest.fn() }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { approvePayWeek } from '@/lib/payroll-approve'
import { loadPayWeek } from '@/lib/payroll-pay-week'

const ORG = 'org1'
const NOW = new Date('2026-10-22T20:00:00Z')

function build(extra: Record<string, Array<Record<string, unknown>>> = {}) {
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
    {
      relations: { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } },
      rpc: {
        // The real claim function sets the token on the open period; the fake does the same.
        payroll_claim_period_lock: (args, tables) => {
          const row = (tables.payroll_periods ?? []).find((r) => r.id === args.p_period_id && r.status === 'open')
          if (!row) return false
          row.lock_claim_token = args.p_token
          return true
        },
      },
    }
  )
}

describe('approvePayWeek', () => {
  it('approves exactly the total it was shown: locks and writes the previewed lines; a pending bonus does not block it', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const periodId = week.period.id
    db.tables.payroll_bonus_lines = [{ id: 'b1', org_id: ORG, payroll_period_id: periodId, user_id: 's1', bonus_type: 'manual', amount: 250, status: 'pending_approval' }]

    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'admin', periodId, expectedTotal: week.totals.amount, now: NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.total).toBe(2400)
    expect(res.mismatch).toBe(false)
    expect(db.tables.payroll_periods.find((p) => p.id === periodId)?.status).toBe('locked')
    expect((db.tables.payroll_payout_lines ?? []).map((l) => [l.user_id, l.net_amount]).sort()).toEqual([['c1', 1400], ['s1', 1000]])
    // The unapproved bonus stays where it is (nothing was moved before the lock) and shows up on the NEXT open week.
    expect(db.tables.payroll_bonus_lines[0].payroll_period_id).toBe(periodId)
    const nextCutoff = new Date(new Date(week.period.cutoffAt).getTime() + 7 * 86_400_000).toISOString()
    db.tables.payroll_periods.push({ id: 'next', org_id: ORG, status: 'open', cutoff_at: nextCutoff, scheduled_pay_date: '2026-10-30', period_label: 'next', created_at: '2026-10-23' })
    const nextWeek = await loadPayWeek(db.client, ORG, new Date('2026-10-29T20:00:00Z'), 'next')
    expect(nextWeek.needs.find((n) => n.kind === 'bonus')).toMatchObject({ id: 'b1', amount: 250, fromWeek: '2026-10-21' })
  })

  it('a stranded bonus is approved by moving it onto the open week, and is then in that week\'s total', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    db.tables.payroll_periods.push({ id: 'old', org_id: ORG, status: 'locked', cutoff_at: '2026-10-08T03:59:59.999Z', scheduled_pay_date: '2026-10-09', period_label: 'old', created_at: '2026-10-01' })
    db.tables.payroll_bonus_lines = [{ id: 'b9', org_id: ORG, payroll_period_id: 'old', user_id: 's1', bonus_type: 'setter_weekly_floor', amount: 100, status: 'pending_approval' }]
    const before = await loadPayWeek(db.client, ORG, NOW)
    expect(before.needs.find((n) => n.kind === 'bonus')).toMatchObject({ id: 'b9', fromWeek: '2026-10-07' })
    // approve it via the same update the route performs
    await (db.client as never as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } } }).from('payroll_bonus_lines').update({ status: 'approved', payroll_period_id: week.period.id }).eq('id', 'b9')
    const after = await loadPayWeek(db.client, ORG, NOW)
    expect(after.totals.amount).toBe(2400 + 100)
    expect(after.people.find((p) => p.name === 'Riley Moss')?.lines.some((l) => l.kind === 'Bonus' && l.amount === 100)).toBe(true)
  })

  it('refuses to approve a week that has not ended yet', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const early = new Date(new Date(week.period.cutoffAt).getTime() - 3_600_000)
    expect(await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: early })).toMatchObject({ ok: false, status: 409, body: { code: 'not_ended' } })
    expect(db.tables.payroll_payout_lines ?? []).toHaveLength(0)
  })

  it('shows the backlog (jobs that finished before the week) so the confirmation can say so', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    expect(week.backlog).toEqual({ jobs: 1, amount: 2400, since: '2026-10-15' })
  })

  it('refuses when the numbers changed since the screen was loaded — nothing is paid', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'admin', periodId: week.period.id, expectedTotal: week.totals.amount + 1, now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409, body: { code: 'changed', total: 2400 } })
    expect(db.tables.payroll_payout_lines ?? []).toHaveLength(0)
    expect(db.tables.payroll_periods[0].status).toBe('open')
  })

  it('an approved week never reopens or approves twice', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const args = { orgId: ORG, actorUserId: 'admin', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW }
    expect((await approvePayWeek(db.client, args)).ok).toBe(true)
    expect(await approvePayWeek(db.client, args)).toMatchObject({ ok: false, status: 409, body: { error: 'This week is already approved' } })
    expect(db.tables.payroll_payout_lines).toHaveLength(2)
  })

  it('nothing to pay → no approval', async () => {
    const db = build({ production_jobs: [] })
    const week = await loadPayWeek(db.client, ORG, NOW)
    expect(await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: 0, now: NOW })).toMatchObject({ ok: false, body: { error: 'Nothing to pay this week' } })
  })
})
