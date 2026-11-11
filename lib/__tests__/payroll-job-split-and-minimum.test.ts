jest.mock('@/lib/payroll-statement-email', () => ({ sendPayrollStatementEmail: jest.fn() }))

import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fakePayrollRpcs, minimumUnanswered } from '@/lib/test-helpers/fake-payroll-rpc'
import { approvePayWeek } from '@/lib/payroll-approve'
import { exactShare, loadJobSplit, planJobSplitWrites } from '@/lib/payroll-job-split'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { countsTowardMinimum, minimumBasisTotal, saveMinimumDecision, weekMinimumFor, weeklyMinimumOutcome, weeklyMinimumMath, parseWeeklyMinimum } from '@/lib/payroll-weekly-minimum'
import { addAdjustment } from '@/lib/payroll-adjustments'
import { loadMyPay } from '@/lib/my-pay'

const ORG = 'org1'
const NOW = new Date('2026-10-22T20:00:00Z') // Thursday: the week ending Wed 10-21 has ended (legacy schedule)

function build(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const plan = (id: string, pct: number, more: Record<string, unknown> = {}) => ({ id, name: id, plan_type: 'percentage', base_percentage: pct, is_active: true, org_id: ORG, ...more })
  return createFakeDb(
    {
      payroll_periods: [],
      production_jobs: [{ id: 'j1', org_id: ORG, job_number: '26-0141', status: 'complete', address_text: '12 Elm St', sale_date: '2026-10-05', sale_amount: 20000, commission_comp_base: 20000, commission_pre_tax_subtotal: 20000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z' }],
      job_payments: [{ job_id: 'j1', amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' }],
      projects: [{ id: 'pr1', org_id: ORG, opportunity_id: 'o1' }],
      opportunities: [{ id: 'o1', org_id: ORG, owner_user_id: 'c1', setter_user_id: 's1' }],
      users: [
        { id: 'a', org_id: ORG, full_name: 'Owner A', role: 'admin', active: true, is_super_admin: true },
        { id: 'c1', org_id: ORG, full_name: 'Jordan Vale', role: 'sales_rep', active: true },
        { id: 's1', org_id: ORG, full_name: 'Riley Moss', role: 'canvasser', active: true },
        { id: 'n1', org_id: ORG, full_name: 'Nathan Owner', role: 'sales_rep', active: true },
      ],
      comp_plans: [plan('plan-closer', 7), plan('plan-fm', 3, { weekly_minimum: { amount: 500, needsCheck: true } })],
      user_comp_plans: [
        { user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
        { user_id: 's1', org_id: ORG, comp_plan_id: 'plan-fm', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
      ],
      ...extra,
    },
    { relations: { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } }, rpc: fakePayrollRpcs }
  )
}

describe('weekly minimum ("greater of $500 or 3%") — pure rule', () => {
  it('pays the gap only, never adds the two', () => {
    const r = parseWeeklyMinimum({ amount: 500 })!
    expect(r).toEqual({ amount: 500, needsCheck: true, prorate: true, basis: 'gross' })
    expect(weeklyMinimumOutcome(r, 600, true, true)).toEqual({ state: 'commission_higher', topUp: 0 })
    expect(weeklyMinimumOutcome(r, 500, null, true)).toEqual({ state: 'commission_higher', topUp: 0 })
    expect(weeklyMinimumOutcome(r, 180, true, true)).toEqual({ state: 'pays', topUp: 320 })
    expect(weeklyMinimumOutcome(r, 180, false, true)).toEqual({ state: 'not_met', topUp: 0 })
    expect(weeklyMinimumOutcome(r, 180, null, true)).toEqual({ state: 'needs_answer', topUp: 320 })
    expect(weeklyMinimumOutcome({ amount: 500, needsCheck: false, prorate: true, basis: 'gross' as const }, 180, null, true)).toEqual({ state: 'pays', topUp: 320 })
    // someone who left mid-week: only on an explicit yes, even without a check
    expect(weeklyMinimumOutcome({ amount: 500, needsCheck: false, prorate: true, basis: 'gross' as const }, 180, null, false).state).toBe('needs_answer')
    expect(weeklyMinimumMath(500, 180, 320)).toBe('Greater of $500 or earnings: $500 − $180 earned = $320')
  })
  it.each([[null], [{}], [{ amount: 0 }], [{ amount: -5 }], [{ amount: 'x' }], [[500]]])('no rule for %j', (raw) => expect(parseWeeklyMinimum(raw)).toBeNull())
})

describe('weekly minimum on the Pay screen, Approve and My pay', () => {
  it('asks the office, pays the top-up as one line with its math, freezes it at Approve, and the rep sees the same', async () => {
    const db = build()
    let week = await loadPayWeek(db.client, ORG, NOW)
    const fm = () => week.people.find((p) => p.userId === 's1')!
    // Riley earns 3% of $20,000 = $600 > $500: no question, no top-up.
    expect(fm().total).toBe(600)
    expect(week.needs.some((n) => n.kind === 'minimum')).toBe(false)

    // A smaller job: 3% of $6,000 = $180 → the office is asked.
    db.tables.production_jobs[0].commission_comp_base = 6000
    db.tables.production_jobs[0].sale_amount = 6000
    db.tables.job_payments[0].amount_cents = 600000
    week = await loadPayWeek(db.client, ORG, NOW)
    expect(week.needs).toContainEqual({ kind: 'minimum', userId: 's1', name: 'Riley Moss', minimum: 500, commission: 180, topUp: 320 })
    expect(fm().total).toBe(180)

    // Yes → one "Weekly minimum" line; the check is $500, not $680.
    await saveMinimumDecision(db.client, { orgId: ORG, periodId: week.period.id, userId: 's1', met: true, actorUserId: 'a' })
    week = await loadPayWeek(db.client, ORG, NOW)
    expect(fm().lines.find((l) => l.kind === 'Minimum')).toEqual({ kind: 'Minimum', what: 'Weekly minimum', math: 'Greater of $500 or earnings: $500 − $180 earned = $320', amount: 320 })
    expect(fm().total).toBe(500)
    expect(week.needs.some((n) => n.kind === 'minimum')).toBe(false)

    // The rep's My pay says the same.
    const mine = await loadMyPay(db.client, ORG, 's1', NOW)
    expect(mine.headline.amount).toBe(500)
    expect(mine.thisWeek.map((l) => l.lineKind)).toEqual(expect.arrayContaining(['Commission', 'Minimum']))

    // Approve stores it; the database total (incl. the minimum) matches what was shown.
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    expect(res.ok).toBe(true)
    expect(db.tables.payroll_week_minimums.find((m) => m.user_id === 's1')).toMatchObject({ amount: 320, met: true })
    const approved = await loadPayWeek(db.client, ORG, NOW, week.period.id)
    expect(approved.people.find((p) => p.userId === 's1')!.total).toBe(500)
    // Editing the plan afterwards never changes the approved week.
    db.tables.comp_plans.find((p) => p.id === 'plan-fm')!.weekly_minimum = { amount: 900 }
    expect((await loadPayWeek(db.client, ORG, NOW, week.period.id)).people.find((p) => p.userId === 's1')!.total).toBe(500)
  })

  it('No → commission only', async () => {
    const db = build()
    db.tables.production_jobs[0].commission_comp_base = 6000
    const week = await loadPayWeek(db.client, ORG, NOW)
    await saveMinimumDecision(db.client, { orgId: ORG, periodId: week.period.id, userId: 's1', met: false, actorUserId: 'a' })
    const after = await loadPayWeek(db.client, ORG, NOW)
    expect(after.people.find((p) => p.userId === 's1')!.total).toBe(180)
    expect(after.needs.some((n) => n.kind === 'minimum')).toBe(false)
  })
})

describe('the Change sheet (one job, who gets what %, one reason)', () => {
  it('re-splits 26-0036-style in one save: closer 9%, setter off, add a partner 9%; audited; the week shows it', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const loaded = await loadJobSplit(db.client, ORG, week.period.id, 'j1', NOW)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.value.lines.map((l) => [l.name, l.word, l.percent, l.amount])).toEqual(
      expect.arrayContaining([['Jordan Vale', 'closer', 7, 1400], ['Riley Moss', 'setter', 3, 600]])
    )
    const closer = loaded.value.lines.find((l) => l.userId === 'c1')!
    const setter = loaded.value.lines.find((l) => l.userId === 's1')!
    const planned = planJobSplitWrites(loaded.value, { lines: [{ key: closer.key, percent: 9 }, { key: setter.key, percent: null }], added: [{ userId: 'n1', percent: 9 }] })
    expect(planned).toEqual({
      ok: true,
      rows: [
        { user_id: 'c1', role: 'closer', override_percent: 9, override_amount: null, clear: false },
        { user_id: 's1', role: 'setter', override_percent: 0, override_amount: null, clear: false },
        { user_id: 'n1', role: 'custom', override_percent: 9, override_amount: null, clear: false },
      ],
    })
    if (!planned.ok) return
    const { error } = await (db.client as unknown as SupabaseClient).rpc('payroll_set_job_split', { p_org_id: ORG, p_job_id: 'j1', p_period_id: week.period.id, p_actor_user_id: 'a', p_reason: 'Closed with Nathan, no setter', p_rows: planned.rows })
    expect(error).toBeNull()
    expect(db.tables.payroll_override_audit).toHaveLength(3)

    const after = await loadPayWeek(db.client, ORG, NOW)
    const paid = Object.fromEntries(after.jobs[0].paid.map((p) => [p.userId, p.amount]))
    // 18% pool cap (3,600): 9% + 9% = 18% fits exactly.
    expect(paid).toEqual({ c1: 1800, s1: 0, n1: 1800 })

    // Unchanged lines write nothing; "back to plan" deletes only an office row.
    const again = await loadJobSplit(db.client, ORG, week.period.id, 'j1', NOW)
    if (!again.ok) return
    expect(planJobSplitWrites(again.value, { lines: again.value.lines.map((l) => ({ key: l.key, percent: l.percent })), added: [] })).toEqual({ ok: true, rows: [] })
    const back = planJobSplitWrites(again.value, { lines: [{ key: again.value.lines.find((l) => l.userId === 's1')!.key, percent: 0, backToPlan: true }], added: [] })
    expect(back).toEqual({ ok: true, rows: [{ user_id: 's1', role: 'setter', override_percent: null, override_amount: null, clear: true }] })
  })

  it('refuses over 100%, a duplicate person, and any change once the job is paid', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const s = await loadJobSplit(db.client, ORG, week.period.id, 'j1', NOW)
    if (!s.ok) throw new Error('load')
    expect(planJobSplitWrites(s.value, { lines: [], added: [{ userId: 'n1', percent: 95 }] }).ok).toBe(false)
    expect(planJobSplitWrites(s.value, { lines: [], added: [{ userId: 'n1', percent: 1 }, { userId: 'n1', percent: 1 }] }).ok).toBe(false)
    await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    const { error } = await (db.client as unknown as SupabaseClient).rpc('payroll_set_job_split', { p_org_id: ORG, p_job_id: 'j1', p_period_id: week.period.id, p_actor_user_id: 'a', p_reason: 'x', p_rows: [{ user_id: 'c1', role: 'closer', override_percent: 1, override_amount: null, clear: false }] })
    expect(error?.message).toMatch(/job_split:already_paid/)
    expect((await loadJobSplit(db.client, ORG, week.period.id, 'j1', NOW)).ok).toBe(false)
  })
})

describe('review fixes: minimum counts, blocks Approve, pro-rates', () => {
  it('which lines count: gross (default) = commission, hours, per-unit, bonuses, job fixes; commission basis = commission + job fixes', () => {
    for (const k of ['Commission', 'Hourly', 'Units', 'Bonus']) expect(countsTowardMinimum({ kind: k })).toBe(true)
    expect(countsTowardMinimum({ kind: 'Adjustment', adjustmentKind: 'fix', jobId: 'j1' })).toBe(true)
    expect(countsTowardMinimum({ kind: 'Adjustment', adjustmentKind: 'fix', jobId: null })).toBe(false)
    expect(countsTowardMinimum({ kind: 'Adjustment', adjustmentKind: 'balance', jobId: 'j1' })).toBe(false)
    expect(countsTowardMinimum({ kind: 'Minimum' })).toBe(false)
    for (const k of ['Hourly', 'Units', 'Bonus', 'Minimum']) expect(countsTowardMinimum({ kind: k }, 'commission')).toBe(false)
    expect(countsTowardMinimum({ kind: 'Commission' }, 'commission')).toBe(true)
  })

  it('$180 commission + a $200 job fix = $500 check, not $700', async () => {
    const db = build()
    db.tables.production_jobs[0].commission_comp_base = 6000
    db.tables.production_jobs[0].sale_amount = 6000
    db.tables.job_payments[0].amount_cents = 600000
    let week = await loadPayWeek(db.client, ORG, NOW)
    const fix = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: 200, reason: 'Missed split on 26-0141', jobId: 'j1' })
    expect(fix.ok).toBe(true)
    await saveMinimumDecision(db.client, { orgId: ORG, periodId: week.period.id, userId: 's1', met: true, actorUserId: 'a' })
    week = await loadPayWeek(db.client, ORG, NOW)
    const riley = week.people.find((p) => p.userId === 's1')!
    expect(riley.lines.find((l) => l.kind === 'Minimum')!.amount).toBe(120)
    expect(riley.total).toBe(500)
  })

  it('an unanswered minimum blocks Approve with a plain prompt; answering unblocks it', async () => {
    const db = build()
    db.tables.production_jobs[0].commission_comp_base = 6000
    let week = await loadPayWeek(db.client, ORG, NOW)
    expect(week.canApprove).toBe(false)
    expect(week.blockedBy).toEqual({ code: 'minimum_unanswered', text: 'Answer the weekly minimum for 1 person first.', count: 1 })
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    expect(res).toMatchObject({ ok: false, status: 409, body: { code: 'minimum_unanswered' } })
    expect(db.tables.payroll_periods[0].status).toBe('open')
    await saveMinimumDecision(db.client, { orgId: ORG, periodId: week.period.id, userId: 's1', met: false, actorUserId: 'a' })
    week = await loadPayWeek(db.client, ORG, NOW)
    expect(week.blockedBy).toBeNull()
    expect((await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })).ok).toBe(true)
  })

  it('pro-rates a short or long in-between week by default; off = full amount', () => {
    const r = parseWeeklyMinimum({ amount: 500 })!
    expect(weekMinimumFor(r, 4)).toBe(285.71)
    expect(weekMinimumFor(r, 11)).toBe(785.71)
    expect(weekMinimumFor(r, 7)).toBe(500)
    expect(weekMinimumFor(parseWeeklyMinimum({ amount: 500, prorate: false })!, 4)).toBe(500)
    expect(weeklyMinimumOutcome(r, 180, true, true, 4)).toEqual({ state: 'pays', topUp: 105.71 })
    expect(weeklyMinimumMath(285.71, 180, 105.71, 4)).toBe('Greater of $285.71 (4-day week) or earnings: $285.71 − $180 earned = $105.71')
  })
})

describe('review fix: Change sheet keeps a second manager\'s automatic override', () => {
  const split = {
    job: { base: 20000 },
    lines: [
      { key: 'c|sales_rep', userId: 'c', name: 'C', role: 'sales_rep', storageRole: 'closer', word: 'closer', percent: 7, amount: 1400, gross: 1400, setByOffice: false },
      { key: 'm1|closer_manager_override', userId: 'm1', name: 'M1', role: 'closer_manager_override', storageRole: 'closer_manager_override', word: 'sales manager override', percent: 2, amount: 400, gross: 400, setByOffice: false },
      { key: 'm2|closer_manager_override', userId: 'm2', name: 'M2', role: 'closer_manager_override', storageRole: 'closer_manager_override', word: 'sales manager override', percent: 1, amount: 200, gross: 200, setByOffice: false },
      { key: 'm3|setter_manager_override', userId: 'm3', name: 'M3', role: 'setter_manager_override', storageRole: 'setter_manager_override', word: 'setter manager override', percent: 1, amount: 200, gross: 200, setByOffice: false },
    ],
  }
  it('changing one closer-lane manager writes the other closer-lane manager at their share (setter lane untouched)', () => {
    const r = planJobSplitWrites(split, { lines: [{ key: 'm1|closer_manager_override', percent: 3 }], added: [] })
    expect(r).toEqual({ ok: true, rows: [
      { user_id: 'm1', role: 'closer_manager_override', override_percent: 3, override_amount: null, clear: false },
      { user_id: 'm2', role: 'closer_manager_override', override_percent: 1, override_amount: null, clear: false },
    ] })
  })
  it('taking one manager off keeps the other', () => {
    const r = planJobSplitWrites(split, { lines: [{ key: 'm2|closer_manager_override', percent: null }], added: [] })
    expect(r.ok && r.rows.find((x) => x.user_id === 'm1')).toEqual({ user_id: 'm1', role: 'closer_manager_override', override_percent: 2, override_amount: null, clear: false })
  })
  it('back to plan only for the whole lane', () => {
    const set = { job: split.job, lines: split.lines.map((l) => (l.role === 'closer_manager_override' ? { ...l, setByOffice: true } : l)) }
    expect(planJobSplitWrites(set, { lines: [{ key: 'm1|closer_manager_override', percent: 0, backToPlan: true }], added: [] }).ok).toBe(false)
    expect(planJobSplitWrites(set, { lines: [{ key: 'm1|closer_manager_override', percent: 0, backToPlan: true }, { key: 'm2|closer_manager_override', percent: 0, backToPlan: true }], added: [] }).ok).toBe(true)
  })
})

describe('second review: minimum basis = gross earnings (default); balances and advances after the floor', () => {
  const minFor = (lines: Array<{ kind: string; amount: number; adjustmentKind?: string; jobId?: string }>) => {
    const r = parseWeeklyMinimum({ amount: 500 })!
    const earned = minimumBasisTotal(lines, r.basis)
    return weeklyMinimumOutcome(r, earned, true, true).topUp
  }
  it('$500 commission + a -$300 job clawback → earned $200 → $300 top-up ($500 check)', () => {
    expect(minFor([{ kind: 'Commission', amount: 500 }, { kind: 'Adjustment', amount: -300, adjustmentKind: 'fix', jobId: 'j' }])).toBe(300)
  })
  it('$300 hours + $180 commission → earned $480 → $20 top-up', () => {
    expect(minFor([{ kind: 'Hourly', amount: 300 }, { kind: 'Commission', amount: 180 }])).toBe(20)
  })
  it('-$100 carried balance is applied AFTER the floor: $180 + $320 top-up − $100 = $400 check', async () => {
    expect(minFor([{ kind: 'Commission', amount: 180 }, { kind: 'Adjustment', amount: -100, adjustmentKind: 'balance' }])).toBe(320)
    const db = build({ payroll_adjustments: [] })
    db.tables.production_jobs[0].commission_comp_base = 6000
    db.tables.production_jobs[0].sale_amount = 6000
    db.tables.job_payments[0].amount_cents = 600000
    const week0 = await loadPayWeek(db.client, ORG, NOW)
    db.tables.payroll_adjustments = [{ id: 'bal', org_id: ORG, payroll_period_id: week0.period.id, user_id: 's1', amount: -100, reason: 'Carried over', kind: 'balance', status: 'pending', job_id: null }]
    await saveMinimumDecision(db.client, { orgId: ORG, periodId: week0.period.id, userId: 's1', met: true, actorUserId: 'a' })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const riley = week.people.find((p) => p.userId === 's1')!
    expect(riley.lines.find((l) => l.kind === 'Minimum')).toMatchObject({ amount: 320, math: 'Greater of $500 or earnings: $500 − $180 earned = $320' })
    expect(riley.total).toBe(400)
  })
  it('commission basis ignores hours', () => {
    const r = parseWeeklyMinimum({ amount: 500, basis: 'commission' })!
    expect(minimumBasisTotal([{ kind: 'Hourly', amount: 300 }, { kind: 'Commission', amount: 180 }], r.basis)).toBe(180)
    expect(weeklyMinimumMath(500, 180, 320, 7, 'commission')).toBe('Greater of $500 or commission: $500 − $180 commission = $320')
  })
})

describe('second review: pinned shares keep every cent', () => {
  it('a 1.333...% manager line is pinned at full precision (or flat dollars), paying exactly the same cents', () => {
    expect(exactShare(266.67, 20005)).toEqual({ override_percent: 1.333017, override_amount: null })
    // gross that no 6-decimal percent reproduces -> flat dollars
    const odd = exactShare(0.01, 1_000_000_000)
    expect(odd.override_amount ?? Math.round(1_000_000_000 * (odd.override_percent! / 100) * 100) / 100).toBe(0.01)
    for (let i = 0; i < 2000; i++) {
      const base = Math.round(Math.random() * 6_000_000) / 100 + 1000
      const gross = Math.round(base * (Math.random() * 10)) / 100
      const sh = exactShare(gross, base)
      const paid = sh.override_amount != null ? sh.override_amount : Math.round(Math.round(base * 100) / 100 * (sh.override_percent! / 100) * 100) / 100
      expect(Math.round(paid * 100)).toBe(Math.round(gross * 100))
    }
  })
})

describe('second review: Approve is refused in SQL too while a minimum is unanswered (TS/SQL parity)', () => {
  const scenario = (extra: (periodId: string) => Record<string, Array<Record<string, unknown>>>, listed: string[]) => async () => {
    const db = build({ production_jobs: [] })
    const week0 = await loadPayWeek(db.client, ORG, NOW)
    for (const [t, rows] of Object.entries(extra(week0.period.id))) db.tables[t] = rows
    const week = await loadPayWeek(db.client, ORG, NOW)
    const ts = week.needs.filter((n) => n.kind === 'minimum').map((n) => (n as { userId: string }).userId).sort()
    const sqlTwin = minimumUnanswered(db.tables as never, ORG, week.period.id).sort()
    expect(sqlTwin).toEqual(ts)
    expect(ts).toEqual(listed)
    return { db, week, ts }
  }
  const line = (p: string, user: string, amt: number) => ({ id: `l${amt}`, org_id: ORG, payroll_period_id: p, job_id: 'jx', user_id: user, participant_role: 'setter', gross_amount: amt, net_amount: amt, comp_plan_snapshot: {} })
  it('below the floor, no answer -> both list them', scenario((p) => ({ payroll_payout_lines: [line(p, 's1', 180)] }), ['s1']))
  it('hours lift them over the floor (gross) -> neither lists them', scenario((p) => ({ payroll_payout_lines: [line(p, 's1', 180)], payroll_rep_hours: [{ org_id: ORG, payroll_period_id: p, user_id: 's1', regular_hours: 30, hourly_earnings: 330, has_entry: true }] }), []))
  it('a job clawback drops them under -> both list them', scenario((p) => ({ payroll_payout_lines: [line(p, 's1', 600)], payroll_adjustments: [{ id: 'f', org_id: ORG, payroll_period_id: p, user_id: 's1', amount: -300, reason: 'x', kind: 'fix', status: 'pending', job_id: 'jx' }] }), ['s1']))
  it('a carried balance does not count (applied after the floor) -> not listed when commission covers it', scenario((p) => ({ payroll_payout_lines: [line(p, 's1', 600)], payroll_adjustments: [{ id: 'b', org_id: ORG, payroll_period_id: p, user_id: 's1', amount: -300, reason: 'x', kind: 'balance', status: 'pending', job_id: null }] }), []))
  it('the commit itself refuses (bypassing the screen)', async () => {
    const db = build({ production_jobs: [] })
    const week = await loadPayWeek(db.client, ORG, NOW)
    db.tables.payroll_payout_lines = [line(week.period.id, 's1', 180)]
    db.tables.payroll_periods[0].lock_claim_token = 'tok'
    const { error } = await (db.client as unknown as SupabaseClient).rpc('payroll_commit_week', { p_org_id: ORG, p_period_id: week.period.id, p_token: 'tok', p_actor_user_id: 'a', p_expected_total: 180, p_plan: { jobs: [], units: [] } })
    expect(error?.message).toMatch(/payroll_commit:minimum_unanswered/)
    expect(db.tables.payroll_periods[0].status).toBe('open')
  })
})
