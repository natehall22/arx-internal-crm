/** The side-by-side dry run: chosen weeks on the company's pay week, nothing written, each job in the week it first became due. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { simulatePayWeek } from '@/lib/payroll-simulate-week'

const ORG = 'org1'
const NOW = new Date('2026-11-20T12:00:00Z')
const job = (id: string, num: string, completed: string, extra: Record<string, unknown> = {}) => ({ id, org_id: ORG, job_number: num, status: 'collected', address_text: 'x', sale_date: '2026-10-01', sale_amount: 10000, commission_comp_base: 10000, commission_pre_tax_subtotal: 10000, dealer_fee_amount: 0, salesperson_id: 'c1', project_id: null, completed_at: completed, ...extra })
const pay = (jobId: string, at: string) => ({ job_id: jobId, amount_cents: 1000000, funding_status: 'cleared', paid_at: at.slice(0, 10), created_at: at })

function build() {
  return createFakeDb(
    {
      orgs: [{ id: ORG, timezone: 'America/New_York', settings: { payWeek: { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 3, time: '23:59' } } } }],
      payroll_periods: [],
      production_jobs: [
        job('j1', '26-0048', '2026-11-05T16:46:56Z'),
        job('j2', '26-0043', '2026-11-08T17:00:00Z'), // installed Sunday, money in Tuesday 11-10 -> rides the late-money window into week 11-08
        job('j3', '26-0030', '2026-11-03T12:00:00Z', { payroll_settled_externally_at: '2026-11-04T00:00:00Z' }), // paid outside: still shown in the dry run
      ],
      job_payments: [pay('j1', '2026-11-06T12:00:00Z'), pay('j2', '2026-11-10T15:00:00Z'), pay('j3', '2026-11-04T12:00:00Z')],
      users: [{ id: 'c1', org_id: ORG, full_name: 'Jordan Vale', role: 'sales_rep', active: true }],
      comp_plans: [{ id: 'pc', name: 'Closer', plan_type: 'percentage', base_percentage: 7, is_active: true, org_id: ORG }],
      user_comp_plans: [{ user_id: 'c1', org_id: ORG, comp_plan_id: 'pc', effective_from: '2026-01-01', effective_to: null, override_percentage: null, hourly_rate_override: null }],
    },
    { relations: { user_comp_plans: { comp_plans: { table: 'comp_plans', fk: 'comp_plan_id' } } } }
  )
}

describe('simulatePayWeek', () => {
  it('puts each job in the week it first became due, includes jobs paid outside, writes nothing', async () => {
    const db = build()
    const w = await simulatePayWeek(db.client, ORG, '2026-11-08', NOW)
    expect(w.payDate).toBe('2026-11-13')
    expect(w.people).toEqual([{ userId: 'c1', name: 'Jordan Vale', total: 2100, commission: 2100, jobs: ['26-0030', '26-0043', '26-0048'], minimumIfMet: 0 }])
    const next = await simulatePayWeek(db.client, ORG, '2026-11-15', NOW)
    expect(next.people).toEqual([])
    expect(db.tables.payroll_periods).toEqual([])
  })
  it('refuses a date that is not the company\'s cutoff day', async () => {
    await expect(simulatePayWeek(build().client, ORG, '2026-11-11', NOW)).rejects.toThrow(/not a Sunday/)
  })
})
