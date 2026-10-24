jest.mock('@/lib/payroll-statement-email', () => ({ sendPayrollStatementEmail: jest.fn() }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fakePayrollRpcs } from '@/lib/test-helpers/fake-payroll-rpc'
import { addAdjustment, voidAdjustment } from '@/lib/payroll-adjustments'
import { approvePayWeek } from '@/lib/payroll-approve'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { computeNetPayout } from '@/lib/payroll-statement'

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
      rpc: fakePayrollRpcs,
    }
  )
}
const UUIDISH = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('adjustments', () => {
  it('the net formula counts fixes', () => {
    expect(computeNetPayout({ commission: 1400, hourly: 0, units: 0, bonus: 0, chargebacks: 0, adjustments: 322 })).toBe(1722)
    expect(computeNetPayout({ commission: 100, hourly: 0, units: 0, bonus: 0, chargebacks: 0 })).toBe(100)
  })

  it('a fix on an OPEN week is a line on that week and moves the total', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const res = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: 322, reason: 'Closed alone' })
    expect(res).toMatchObject({ ok: true, nextWeek: false, periodId: week.period.id })
    const after = await loadPayWeek(db.client, ORG, NOW)
    expect(after.totals.amount).toBe(2400 + 322)
    const riley = after.people.find((p) => p.name === 'Riley Moss')!
    expect(riley.total).toBe(1322)
    expect(riley.lines.find((l) => l.kind === 'Adjustment')).toMatchObject({ amount: 322, math: 'Closed alone' })
  })

  it('a fix on an APPROVED week never touches it: it lands on next week (created) and shows there', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    const res = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 'c1', amount: -150, reason: 'Paid twice on 26-0129' })
    expect(res).toMatchObject({ ok: true, nextWeek: true })
    if (!res.ok) return
    expect(res.periodId).not.toBe(week.period.id)
    // the approved week is unchanged
    const approved = await loadPayWeek(db.client, ORG, NOW, week.period.id)
    expect(approved.totals.amount).toBe(2400)
    expect(approved.nextWeek?.fixes).toEqual([expect.objectContaining({ name: 'Jordan Vale', amount: -150 })])
    // and the next week's draft carries it as a line (negative → carried, floor $0)
    const next = await loadPayWeek(db.client, ORG, NOW, res.periodId)
    expect(next.people.find((p) => p.name === 'Jordan Vale')).toMatchObject({ raw: -150, total: 0 })
  })

  it('a negative week is paid as $0 and the balance is carried to next week when approved', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    // Riley earns $1,000; take back $1,300 → raw −$300
    await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: -1300, reason: 'Cancelled job clawback' })
    const draft = await loadPayWeek(db.client, ORG, NOW)
    expect(draft.people.find((p) => p.name === 'Riley Moss')).toMatchObject({ raw: -300, total: 0 })
    expect(draft.warnings.some((w) => w.code === 'negative')).toBe(true)

    const ok = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: draft.totals.amount, now: NOW })
    expect(ok.ok).toBe(true)
    const carried = (db.tables.payroll_adjustments ?? []).filter((r) => r.kind === 'balance')
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({ user_id: 's1', amount: -300, status: 'pending' })
    expect(carried[0].payroll_period_id).not.toBe(week.period.id)
  })

  it('a pending fix can be removed while the week is open, never after', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const add = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: 50, reason: 'x' })
    if (!add.ok) throw new Error('setup')
    expect(await voidAdjustment(db.client, ORG, add.id)).toEqual({ ok: true })
    expect((await loadPayWeek(db.client, ORG, NOW)).totals.amount).toBe(2400)

    const add2 = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: 50, reason: 'y' })
    if (!add2.ok) throw new Error('setup')
    const w2 = await loadPayWeek(db.client, ORG, NOW)
    await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: w2.totals.amount, now: NOW })
    expect(await voidAdjustment(db.client, ORG, add2.id)).toMatchObject({ ok: false, status: 409 })
  })

  it('validates input', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const base = { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1' }
    expect(await addAdjustment(db.client, { ...base, amount: 0, reason: 'x' })).toMatchObject({ ok: false, status: 400 })
    expect(await addAdjustment(db.client, { ...base, amount: 5, reason: '   ' })).toMatchObject({ ok: false, status: 400 })
    expect(await addAdjustment(db.client, { ...base, amount: 5_000_000, reason: 'x' })).toMatchObject({ ok: false, status: 400 })
    expect(await addAdjustment(db.client, { ...base, userId: UUIDISH(9), amount: 5, reason: 'x' })).toMatchObject({ ok: false, status: 404 })
    expect(await addAdjustment(db.client, { ...base, viewedPeriodId: UUIDISH(8), amount: 5, reason: 'x' })).toMatchObject({ ok: false, status: 404 })
  })

  it('a fix for an old week skips weeks that are already approved and lands on the first OPEN one', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    const c = new Date(week.period.cutoffAt).getTime()
    const mk = (id: string, k: number, status: string) => db.tables.payroll_periods.push({ id, org_id: ORG, status, cutoff_at: new Date(c + k * 7 * 86_400_000).toISOString(), scheduled_pay_date: 'x', period_label: id, created_at: `2026-10-0${k}` })
    mk('w1', 1, 'locked')
    mk('w2', 2, 'open')
    await (db.client as never as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } } }).from('payroll_periods').update({ status: 'locked' }).eq('id', week.period.id)
    const res = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 'c1', amount: 10, reason: 'x' })
    expect(res).toMatchObject({ ok: true, nextWeek: true, periodId: 'w2' })
  })

  it('no fixes are added or removed while an approval is in flight (live lock claim)', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    db.tables.payroll_periods[0].lock_claimed_at = new Date().toISOString()
    expect(await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: 5, reason: 'x' })).toMatchObject({ ok: false, status: 409 })
    delete db.tables.payroll_periods[0].lock_claimed_at
    const add = await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: 5, reason: 'x' })
    if (!add.ok) throw new Error('setup')
    db.tables.payroll_periods[0].lock_claimed_at = new Date().toISOString()
    expect(await voidAdjustment(db.client, ORG, add.id)).toMatchObject({ ok: false, status: 409 })
  })

  it('approving a week with a negative check carries the debt to next week once, and pays only what is positive', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: -1300, reason: 'clawback' })
    const draft = await loadPayWeek(db.client, ORG, NOW)
    expect(draft.totals.amount).toBe(1400) // Riley's check floors at $0
    const { approvePayWeek } = await import('@/lib/payroll-approve')
    const res = await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: draft.totals.amount, now: NOW })
    expect(res.ok).toBe(true)
    const carried = (db.tables.payroll_adjustments ?? []).filter((r) => r.kind === 'balance')
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({ user_id: 's1', amount: -300, status: 'pending', source_period_id: week.period.id })
    expect(carried[0].payroll_period_id).not.toBe(week.period.id)
  })

  it('a long reply still saves as the fix reason (trimmed to 300)', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    expect(await addAdjustment(db.client, { orgId: ORG, actorUserId: 'a', viewedPeriodId: week.period.id, userId: 's1', amount: 5, reason: 'y'.repeat(450) })).toMatchObject({ ok: true })
    expect(String((db.tables.payroll_adjustments ?? [])[0].reason)).toHaveLength(300)
  })
})
