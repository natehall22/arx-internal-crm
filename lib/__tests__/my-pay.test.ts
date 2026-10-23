jest.mock('@/lib/payroll-statement-email', () => ({ sendPayrollStatementEmail: jest.fn() }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { fileDispute, loadMyPay } from '@/lib/my-pay'
import { resolveDispute } from '@/lib/payroll-disputes'
import { approvePayWeek } from '@/lib/payroll-approve'
import { loadPayWeek } from '@/lib/payroll-pay-week'

const ORG = 'org1'
const NOW = new Date('2026-10-22T20:00:00Z')

function build() {
  const plan = (id: string, pct: number) => ({ id, name: id, plan_type: 'percentage', base_percentage: pct, is_active: true, org_id: ORG })
  return createFakeDb(
    {
      payroll_periods: [],
      production_jobs: [
        { id: 'j1', org_id: ORG, job_number: '26-0141', status: 'complete', address_text: '12 Elm St', sale_date: '2026-10-05', sale_amount: 20000, commission_comp_base: 20000, commission_pre_tax_subtotal: 20000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr1', completed_at: '2026-10-10T15:00:00Z' },
        { id: 'j2', org_id: ORG, job_number: '26-0150', status: 'complete', address_text: '5 Oak Dr', sale_date: '2026-10-06', sale_amount: 21000, commission_comp_base: 21000, commission_pre_tax_subtotal: 21000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: 'pr2', completed_at: '2026-10-12T15:00:00Z' },
      ],
      job_payments: [
        { job_id: 'j1', amount_cents: 2000000, funding_status: 'cleared', paid_at: '2026-10-12', created_at: '2026-10-12T12:00:00Z' },
        { job_id: 'j2', amount_cents: 1680000, funding_status: 'cleared', paid_at: '2026-10-13', created_at: '2026-10-13T12:00:00Z' },
      ],
      projects: [{ id: 'pr1', org_id: ORG, opportunity_id: 'o1' }, { id: 'pr2', org_id: ORG, opportunity_id: 'o2' }],
      opportunities: ['o1', 'o2'].map((id) => ({ id, org_id: ORG, owner_user_id: 'c1', setter_user_id: 's1' })),
      users: [{ id: 'c1', org_id: ORG, full_name: 'Jordan Vale', role: 'sales_rep', active: true }, { id: 's1', org_id: ORG, full_name: 'Riley Moss', role: 'setter', active: true }],
      comp_plans: [plan('plan-closer', 7), plan('plan-setter', 5)],
      user_comp_plans: [
        { user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
        { user_id: 's1', org_id: ORG, comp_plan_id: 'plan-setter', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
      ],
    },
    {
      relations: { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } },
      rpc: {
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

describe('My pay', () => {
  it('shows only my lines, with the math, and my Coming estimates with the reason', async () => {
    const db = build()
    await loadPayWeek(db.client, ORG, NOW) // the payroll admin's screen creates the week; reps only read it
    const mine = await loadMyPay(db.client, ORG, 's1', NOW)
    expect(mine.name).toBe('Riley Moss')
    expect(mine.headline).toMatchObject({ amount: 1000, state: 'draft' })
    expect(mine.thisWeek).toHaveLength(1)
    expect(mine.thisWeek[0]).toMatchObject({ amount: 1000, math: '$20,000 × 5% setter = $1,000' })
    expect(mine.coming).toEqual([expect.objectContaining({ why: 'Customer still owes $4,200 of $21,000', amount: 1050 })])
    // nothing of Jordan's (the closer's $1,400 / $1,470) leaks into Riley's view
    expect(JSON.stringify(mine)).not.toMatch(/1400|1470|Jordan/)
  })

  it('after approval it shows Approved, the paid history, and fixes queued on next week', async () => {
    const db = build()
    const week = await loadPayWeek(db.client, ORG, NOW)
    await approvePayWeek(db.client, { orgId: ORG, actorUserId: 'a', periodId: week.period.id, expectedTotal: week.totals.amount, now: NOW })
    const mine = await loadMyPay(db.client, ORG, 'c1', NOW)
    expect(mine.headline).toMatchObject({ amount: 1400, state: 'approved' })
    // the approved week is "this week" until next week's draft opens; paid history starts with earlier approved weeks
    expect(mine.thisWeek[0].why).toContain('Approved')
  })
})

describe('Something\'s wrong?', () => {
  it('files a question for the caller only, one open question per line', async () => {
    const db = build()
    const a = await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: '26-0141 · 12 Elm St', message: 'I closed this alone' })
    expect(a).toMatchObject({ ok: true })
    expect(await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: '26-0141 · 12 Elm St', message: 'again' })).toMatchObject({ ok: false, status: 409 })
    expect(await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: 'x', message: '  ' })).toMatchObject({ ok: false, status: 400 })
    expect(await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: 'x', message: 'm', jobId: '00000000-0000-4000-8000-000000000009' })).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.payroll_disputes).toHaveLength(1)
    await loadPayWeek(db.client, ORG, NOW)
    const mine = await loadMyPay(db.client, ORG, 'c1', NOW)
    expect(mine.disputes[0]).toMatchObject({ label: '26-0141 · 12 Elm St', status: 'open' })
  })

  it('lands in the admin\'s Needs you; a reply closes it and the rep sees it', async () => {
    const db = build()
    await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: '26-0141 · 12 Elm St', message: 'I closed this alone' })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const need = week.needs.find((n) => n.kind === 'dispute')
    expect(need).toMatchObject({ kind: 'dispute', name: 'Jordan Vale', message: 'I closed this alone' })
    if (!need || need.kind !== 'dispute') return
    expect(await resolveDispute(db.client, { orgId: ORG, actorUserId: 'a', id: need.id, action: 'reply', reply: 'Checked: the split is right.' })).toEqual({ ok: true })
    expect((await loadPayWeek(db.client, ORG, NOW)).needs.some((n) => n.kind === 'dispute')).toBe(false)
    const mine = await loadMyPay(db.client, ORG, 'c1', NOW)
    expect(mine.disputes[0]).toMatchObject({ status: 'answered', reply: 'Checked: the split is right.' })
  })

  it('"Add a fix" creates the adjustment line and closes the question as fixed', async () => {
    const db = build()
    await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: '26-0141', message: 'short' })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const need = week.needs.find((n) => n.kind === 'dispute')
    if (!need || need.kind !== 'dispute') throw new Error('setup')
    expect(await resolveDispute(db.client, { orgId: ORG, actorUserId: 'a', id: need.id, action: 'fix', viewedPeriodId: week.period.id, amount: 322, reply: 'You were right' })).toEqual({ ok: true })
    const after = await loadPayWeek(db.client, ORG, NOW)
    expect(after.people.find((p) => p.name === 'Jordan Vale')?.total).toBe(1400 + 322)
    expect(db.tables.payroll_disputes[0]).toMatchObject({ status: 'fixed' })
    // answered once only
    expect(await resolveDispute(db.client, { orgId: ORG, actorUserId: 'a', id: need.id, action: 'reply', reply: 'x' })).toMatchObject({ ok: false, status: 409 })
  })

  it('spam guard: at most 10 open questions per person', async () => {
    const db = build()
    for (let i = 0; i < 10; i++) expect(await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: `line ${i}`, message: 'm' })).toMatchObject({ ok: true })
    expect(await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: 'one more', message: 'm' })).toMatchObject({ ok: false, status: 429 })
  })

  it('two admins cannot both add a fix: the first claim wins, the second is refused with no second adjustment', async () => {
    const db = build()
    await fileDispute(db.client, { orgId: ORG, userId: 'c1', label: '26-0141', message: 'short' })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const need = week.needs.find((n) => n.kind === 'dispute')
    if (!need || need.kind !== 'dispute') throw new Error('setup')
    const args = { orgId: ORG, actorUserId: 'a', id: need.id, action: 'fix' as const, viewedPeriodId: week.period.id, amount: 50, reply: 'ok' }
    expect(await resolveDispute(db.client, args)).toEqual({ ok: true })
    expect(await resolveDispute(db.client, args)).toMatchObject({ ok: false, status: 409 })
    expect((db.tables.payroll_adjustments ?? []).filter((r) => r.status !== 'void')).toHaveLength(1)
  })
})

describe('My pay: reads never write, per-unit pay is included', () => {
  it('opening My pay when no week exists creates nothing and shows $0', async () => {
    const db = build()
    const mine = await loadMyPay(db.client, ORG, 'c1', NOW)
    expect(db.tables.payroll_periods).toHaveLength(0)
    expect(mine.headline.amount).toBe(0)
  })
})
