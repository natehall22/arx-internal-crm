import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fakePayrollRpcs } from '@/lib/test-helpers/fake-payroll-rpc'
import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { advanceOutstanding, describeAdvanceRule, parseAdvanceInput, planAdvanceRecoveries, type AdvanceRow } from '@/lib/payroll-advances'
import { personTotalsFromTables } from '@/lib/payroll-week-total'
import { mergeOrgSettings } from '@/lib/org-settings'

const adv = (o: Partial<AdvanceRow> = {}): AdvanceRow => ({ id: 'a1', userId: 'u1', amount: 500, givenOn: '2026-10-01', note: null, mode: 'full', value: null, firstWeekEnding: '2026-10-21', belowMinimumOk: false, status: 'active', recovered: 0, paidAdjustmentId: null, ...o })
const plan = (advances: AdvanceRow[], pay: number, floor = 0, weekEnding = '2026-10-21') =>
  planAdvanceRecoveries({ weekEnding, advances, pay: new Map([['u1', pay]]), floors: new Map(floor ? [['u1', floor]] : []) })

describe('planAdvanceRecoveries', () => {
  it('full: takes what is left, capped by the check; the rest stays owed', () => {
    expect(plan([adv()], 1400).items.map((i) => i.amount)).toEqual([500])
    const p = plan([adv()], 300)
    expect(p.items.map((i) => i.amount)).toEqual([300])
    expect(p.limited).toEqual([expect.objectContaining({ wanted: 500, taken: 300, because: 'pay' })])
  })
  it('fixed and percent; never more than is owed', () => {
    expect(plan([adv({ mode: 'fixed', value: 200 })], 1400).items[0].amount).toBe(200)
    expect(plan([adv({ mode: 'fixed', value: 200, recovered: 400 })], 1400).items[0].amount).toBe(100)
    expect(plan([adv({ mode: 'percent', value: 20 })], 1234.56).items[0].amount).toBe(246.91)
    expect(plan([adv({ mode: 'percent', value: 50, recovered: 450 })], 1000).items[0].amount).toBe(50)
  })
  it('never takes a check below the weekly minimum unless the owner allowed it; never below $0', () => {
    const p = plan([adv()], 1000, 800)
    expect(p.items[0].amount).toBe(200)
    expect(p.limited[0]).toMatchObject({ because: 'minimum', wanted: 500, taken: 200 })
    expect(plan([adv()], 500, 500).items).toEqual([])
    expect(plan([adv({ belowMinimumOk: true })], 1000, 800).items[0].amount).toBe(500)
    expect(plan([adv({ belowMinimumOk: true })], 300, 800).items[0].amount).toBe(300)
    expect(plan([adv()], -50).items).toEqual([])
  })
  it('waits for its first week, skips cancelled and repaid advances', () => {
    expect(plan([adv()], 1000, 0, '2026-10-14').items).toEqual([])
    expect(plan([adv({ status: 'cancelled' })], 1000).items).toEqual([])
    expect(plan([adv({ recovered: 500 })], 1000).items).toEqual([])
  })
  it('two advances for one person come out oldest first from what is left of the check', () => {
    const p = plan([adv({ id: 'b', givenOn: '2026-10-05', amount: 400 }), adv({ id: 'a', givenOn: '2026-10-01', amount: 300 })], 500)
    expect(p.items.map((i) => [i.advanceId, i.amount])).toEqual([['a', 300], ['b', 200]])
  })
  it('words and input checks', () => {
    expect(advanceOutstanding(adv({ recovered: 120.5 }))).toBe(379.5)
    expect(describeAdvanceRule(adv({ mode: 'fixed', value: 100 }))).toBe('$100 a week')
    expect(parseAdvanceInput({ amount: '-5', mode: 'full' }).ok).toBe(false)
    expect(parseAdvanceInput({ amount: 100, mode: 'fixed', value: 150 }).ok).toBe(false)
    expect(parseAdvanceInput({ amount: 100, mode: 'percent', value: 101 }).ok).toBe(false)
    expect(parseAdvanceInput({ amount: 100.005, mode: 'percent', value: 10 })).toMatchObject({ ok: true, amount: 100.01 })
  })
})

describe('recovery is an ordinary line: preview = Approve = stored', () => {
  const ORG = 'org1'
  const NOW = new Date('2026-10-22T20:00:00Z')
  const seed = () => ({
    payroll_periods: [] as Array<Record<string, unknown>>,
    production_jobs: [{ id: 'j1', org_id: ORG, job_number: '26-0141', status: 'complete', address_text: '12 Elm St', sale_date: '2026-10-05', sale_amount: 20000, commission_comp_base: 20000, commission_pre_tax_subtotal: 20000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z' }],
    job_payments: [{ job_id: 'j1', amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' }],
    projects: [{ id: 'pr1', org_id: ORG, opportunity_id: 'o1' }],
    opportunities: [{ id: 'o1', org_id: ORG, owner_user_id: 'c1', setter_user_id: 's1' }],
    users: [{ id: 'c1', org_id: ORG, full_name: 'Jordan Vale', role: 'sales_rep', active: true }, { id: 's1', org_id: ORG, full_name: 'Riley Moss', role: 'setter', active: true }],
    comp_plans: [{ id: 'plan-closer', name: 'Closer', plan_type: 'percentage', base_percentage: 7, is_active: true, org_id: ORG }, { id: 'plan-setter', name: 'Setter', plan_type: 'percentage', base_percentage: 5, is_active: true, org_id: ORG }],
    user_comp_plans: [
      { user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
      { user_id: 's1', org_id: ORG, comp_plan_id: 'plan-setter', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
    ],
    payroll_advances: [{ id: 'adv1', org_id: ORG, user_id: 'c1', amount: 500, given_on: '2026-10-15', note: 'truck', recovery_mode: 'fixed', recovery_value: 300, first_week_ending: '2026-10-21', below_minimum_ok: false, status: 'active', paid_adjustment_id: null }],
    payroll_adjustments: [] as Array<Record<string, unknown>>,
  })
  const relations = { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } }

  it('shows the repayment as a line, approves exactly that, and the next week owes the rest', async () => {
    const db = createFakeDb(seed(), { relations, rpc: fakePayrollRpcs })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const jordan = week.people.find((p) => p.name === 'Jordan Vale')!
    expect(jordan.lines.find((l) => l.what === 'Advance repaid')).toMatchObject({ kind: 'Adjustment', amount: -300 })
    expect(jordan.lines.find((l) => l.what === 'Advance repaid')?.adjustmentId).toBeUndefined() // not removable one by one
    expect(jordan.total).toBe(1100)
    expect(week.totals.amount).toBe(2100)
    expect(week.advances[0]).toMatchObject({ outstanding: 500, thisWeek: 300 })

    const r = await lockPayrollPeriod(db.client, { orgId: ORG, periodId: week.period.id, actorUserId: 'admin', status: 'open', expectedTotal: week.totals.amount, now: NOW })
    expect(r.ok).toBe(true)
    const stored = (db.tables.payroll_adjustments ?? []).filter((a) => a.kind === 'advance_recovery')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ amount: -300, status: 'applied', advance_id: 'adv1' })
    // The one person-total definition counts it: no second total.
    expect(personTotalsFromTables(db.tables as never, ORG, week.period.id).get('c1')).toBe(1100)

    const approved = await loadPayWeek(db.client, ORG, NOW)
    expect(approved.state).toBe('approved')
    expect(approved.people.find((p) => p.name === 'Jordan Vale')?.total).toBe(1100)
    expect(approved.advances[0]).toMatchObject({ outstanding: 200, thisWeek: 300 })
  })

  it('a cancelled advance takes nothing', async () => {
    const t = seed()
    t.payroll_advances[0].status = 'cancelled'
    const week = await loadPayWeek(createFakeDb(t, { relations, rpc: fakePayrollRpcs }).client, ORG, NOW)
    expect(week.totals.amount).toBe(2400)
    expect(week.advances).toEqual([])
  })
})

describe('payrollExport settings are written only at their own path', () => {
  it('refuses a top-level write', async () => {
    const r = await mergeOrgSettings({} as never, 'o', { payrollExport: {} })
    expect(r.error).toMatch(/payrollExport/)
  })
})
