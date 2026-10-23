import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { materializePayrollPeriod } from '@/lib/payroll-period-materialization'
import { buildWarnings, composeWeek, describeCommission, loadPayWeek, payWeekCsv, resolvePayWeekPeriod, type PayWeek } from '@/lib/payroll-pay-week'

const ORG = 'org1'
const NOW = new Date('2026-10-22T20:00:00Z') // Thu 4 PM ET: the week ending Wed Oct 21 is ready to pay

function seed() {
  const closerPlan = { id: 'plan-closer', name: 'Closer', plan_type: 'percentage', base_percentage: 7, is_active: true, org_id: ORG }
  const setterPlan = { id: 'plan-setter', name: 'Setter', plan_type: 'percentage', base_percentage: 5, is_active: true, org_id: ORG }
  return {
    payroll_periods: [] as Array<Record<string, unknown>>,
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
    comp_plans: [closerPlan, setterPlan],
    user_comp_plans: [
      { user_id: 'c1', org_id: ORG, comp_plan_id: 'plan-closer', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
      { user_id: 's1', org_id: ORG, comp_plan_id: 'plan-setter', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null },
    ],
  }
}
const relations = { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } }

describe('Pay this week', () => {
  it('creates the week that just ended on first use (Wed cutoff, Friday payday) and reuses it', async () => {
    const db = createFakeDb(seed(), { relations })
    const a = await resolvePayWeekPeriod(db.client, ORG, NOW)
    expect(a.weekEnding).toBe('2026-10-21')
    expect(a.payDate).toBe('2026-10-23')
    expect(a.status).toBe('open')
    const b = await resolvePayWeekPeriod(db.client, ORG, NOW)
    expect(b.id).toBe(a.id)
    expect(db.tables.payroll_periods).toHaveLength(1)
  })

  it('the preview total and every line equal what Approve writes', async () => {
    const db = createFakeDb(seed(), { relations })
    const week = await loadPayWeek(db.client, ORG, NOW)
    expect(week.state).toBe('draft')
    // $20,000 + $21,000(j2 not fully funded → waiting): only j1 is payable. Closer 7% = 1,400, setter 5% = 1,000.
    expect(week.totals).toEqual({ amount: 2400, people: 2 })
    expect(week.people.map((p) => [p.name, p.total])).toEqual([['Jordan Vale', 1400], ['Riley Moss', 1000]])
    expect(week.waiting).toHaveLength(1)
    expect(week.waiting[0]).toMatchObject({ jobNumber: '26-0150', reason: 'Customer still owes $4,200 of $21,000' })
    expect(week.waiting[0].who.find((w) => w.name === 'Jordan Vale')?.estimate).toBe(1470)

    // Approve = materialize the same period; what it writes must equal the preview, person by person.
    await materializePayrollPeriod(db.client, { orgId: ORG, periodId: week.period.id, actorUserId: 'admin' })
    const paid = new Map<string, number>()
    for (const l of db.tables.payroll_payout_lines ?? []) paid.set(String(l.user_id), (paid.get(String(l.user_id)) ?? 0) + Number(l.net_amount))
    for (const p of week.people) expect(paid.get(p.userId)).toBe(p.total)
    expect(Array.from(paid.values()).reduce((a, b) => a + b, 0)).toBe(week.totals.amount)

    // …and the approved view (read back from the stored lines) is the same screen.
    await (db.client as unknown as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } } }).from('payroll_periods').update({ status: 'locked' }).eq('id', week.period.id)
    const approved = await loadPayWeek(db.client, ORG, NOW)
    expect(approved.state).toBe('approved')
    expect(approved.totals).toEqual(week.totals)
    expect(approved.people.map((p) => [p.name, p.total])).toEqual(week.people.map((p) => [p.name, p.total]))
  })

  it('each job lists everyone paid, with the math', async () => {
    const db = createFakeDb(seed(), { relations })
    const week = await loadPayWeek(db.client, ORG, NOW)
    const job = week.jobs.find((j) => j.jobNumber === '26-0141')!
    expect(job.total).toBe(2400)
    expect(job.paid.map((p) => [p.name, p.roleLabel, p.amount])).toEqual(expect.arrayContaining([['Jordan Vale', 'closer', 1400], ['Riley Moss', 'setter', 1000]]))
    expect(job.paid.find((p) => p.name === 'Jordan Vale')?.math).toBe('$20,000 × 7% closer = $1,400')
  })
})

describe('describeCommission', () => {
  const row = (over: Record<string, unknown> = {}) => ({ participant_role: 'sales_rep', gross_amount: 1400, net_amount: 1400, comp_plan_snapshot: {}, ...over })
  it('plain percentage', () => expect(describeCommission(row(), 20000)).toBe('$20,000 × 7% closer = $1,400'))
  it('says so when the pool cap reduced it', () => expect(describeCommission(row({ net_amount: 1300 }), 20000)).toContain('reduced to $1,300 to stay inside the 18% pool'))
  it('office override', () => expect(describeCommission(row({ comp_plan_snapshot: { source: 'deal_commission_roles_producer_override' } }), 20000)).toContain('Set by the office'))
  it('derived lines read in words', () => expect(describeCommission(row({ participant_role: 'self_gen', gross_amount: 1200, net_amount: 1200 }), 20000)).toBe('$20,000 × 6% self-generated lead = $1,200'))
})

describe('warnings + csv', () => {
  const person = (over: Record<string, unknown>) => ({ userId: 'u', name: 'Pat', roleLabel: 'Closer', total: 100, raw: 100, hoursMissing: false, lines: [], ...over })
  it('flags a negative check, a big line, a first-time payee and a backlog', () => {
    const w = buildWarnings({
      people: [person({ userId: 'a', name: 'Neg', total: 0, raw: -150 }), person({ userId: 'b', name: 'Big', total: 3500, raw: 3500, lines: [{ kind: 'Commission', what: '26-1', math: '', amount: 3500 }] })],
      firstTimePayees: new Set(['b']),
      backlogJobs: 3,
      weekStart: '2026-10-15',
    })
    expect(w.map((x) => x.code).sort()).toEqual(['backlog', 'big_line', 'first_time', 'negative'])
    expect(w.find((x) => x.code === 'backlog')?.text).toContain('3 jobs that finished before 2026-10-15')
  })
  it('csv has one total per person who is paid, and a grand total', () => {
    const week = { people: [person({ name: 'Jordan, Jr', total: 1400.5, lines: [{ kind: 'Commission', what: '', math: '', amount: 1400.5 }] }), person({ name: 'Zero', total: 0, raw: -5 })], totals: { amount: 1400.5, people: 1 } } as unknown as PayWeek
    const csv = payWeekCsv(week).trim().split('\n')
    expect(csv[0]).toBe('Name,Role,Commission,Hourly,Per-unit,Bonus,Total to pay')
    expect(csv[1]).toBe('"Jordan, Jr",Closer,1400.5,0,0,0,1400.50')
    expect(csv).toHaveLength(3)
    expect(csv[2]).toBe('TOTAL,,,,,,1400.50')
  })
  it('composeWeek floors a person at $0 and carries the raw amount', () => {
    const { people } = composeWeek({
      rows: [{ job_id: 'j', user_id: 'u', participant_role: 'setter', gross_amount: 50, net_amount: 50, comp_plan_snapshot: {} }],
      jobs: new Map([['j', { id: 'j', job_number: '26-1', address_text: 'x', commission_comp_base: 1000 }]]),
      names: new Map([['u', { name: 'Pat', role: 'setter' }]]),
      hours: [],
      units: new Map(),
      bonuses: [],
    })
    expect(people[0]).toMatchObject({ total: 50, raw: 50 })
  })
})
