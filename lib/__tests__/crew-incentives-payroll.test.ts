/**
 * Crew deductions and payroll: a deduction takes back BONUS money only (owner decision), so a person's bonus total is never
 * negative — on the screen (composeWeek), in the stored-rows total the database checks (personTotalsFromTables, the fake
 * mirror of payroll_week_person_totals) and in the ADP / Gusto export. Base pay and the weekly minimum are never touched.
 * (The SQL trigger that enforces the cap on every stored line runs in supabase/tests/payroll_phase2.test.sql.)
 */
jest.mock('@/lib/push-apns', () => ({ sendPushToUser: jest.fn() }))
import { capDeductionCents } from '@/lib/crew-incentives'
import { composeWeek, type PayWeek } from '@/lib/payroll-pay-week'
import { amountsFor, buildProviderExport, readAdpSettings, type ExportPerson } from '@/lib/payroll-provider-export'
import { personTotalsFromTables } from '@/lib/payroll-week-total'

const U = 'u1'
const bonus = (id: string, amount: number, bonusType: string) => ({ id, userId: U, amount, description: bonusType, bonusType })
const row = { job_id: 'j', user_id: U, participant_role: 'setter', gross_amount: 100, net_amount: 100, comp_plan_snapshot: {} }

function week(bonuses: ReturnType<typeof bonus>[], minimums: Array<{ userId: string; amount: number; detail: { minimum: number; commission: number; planName: string | null } }> = []) {
  const { people } = composeWeek({ rows: [row], jobs: new Map(), names: new Map([[U, { name: 'Jordan Vale', role: 'sales_rep' }]]) as never, hours: [], units: new Map(), bonuses, adjustments: [], minimums })
  return people
}

describe('a capped deduction never makes a bonus total negative', () => {
  const earned = [0, 300, 1000, 5000] // cents of crew bonus that week
  const wanted = [-500, -1500, -4000]
  for (const e of earned) {
    for (const w of wanted) {
      it(`earned ${e / 100}, deduction ${w / 100}: the bonus total is >= 0 and base pay is untouched`, () => {
        const cap = capDeductionCents(w, e)
        const bonuses = [bonus('b1', e / 100, 'crew_done_right'), ...(cap.cents !== 0 ? [bonus('b2', cap.cents / 100, 'crew_deduction')] : [])].filter((b) => b.amount !== 0)
        const [p] = week(bonuses)
        const a = amountsFor(p)
        expect(a.bonus).toBeGreaterThanOrEqual(0) // the ADP "BON" earning is never negative
        expect(a.commission).toBe(100) // base pay is exactly what it was
        expect(p.total).toBe(100 + a.bonus)
      })
    }
  }

  it('the weekly-minimum top-up is not lowered by a deduction', () => {
    const cap = capDeductionCents(-4000, 1000)
    const [p] = week([bonus('b1', 10, 'crew_done_right'), bonus('b2', cap.cents / 100, 'crew_deduction')], [{ userId: U, amount: 380, detail: { minimum: 500, commission: 100, planName: null } }])
    const a = amountsFor(p)
    expect(a.commission).toBe(480) // 100 commission + the 380 top-up, as before
    expect(a.bonus).toBe(0) // the 10 earned was fully taken back, nothing more
    expect(p.total).toBe(480)
  })
})

describe('composeWeek, the stored-rows total (fake of the SQL) and the export all agree', () => {
  it('on a week with a capped deduction', () => {
    const cap = capDeductionCents(-1500, 600)
    expect(cap).toEqual({ cents: -600, limited: true })
    const bonuses = [bonus('b1', 6, 'crew_done_right'), bonus('b2', -6, 'crew_deduction')]
    const [p] = week(bonuses)
    const t = (rows: Array<Record<string, unknown>>) => rows.map((r) => ({ org_id: 'o', payroll_period_id: 'p', user_id: U, ...r }))
    const stored = personTotalsFromTables({ payroll_payout_lines: t([{ net_amount: 100 }]), payroll_bonus_lines: t([{ amount: 6, status: 'approved' }, { amount: -6, status: 'approved' }, { amount: -9, status: 'rejected' }]) }, 'o', 'p')
    expect(stored.get(U)).toBe(p.total)
    expect(p.total).toBe(100)
    // The ADP file: BON = 0.00 (never a negative earning); the row ties to the approved pay.
    const w = { period: { weekStart: '2026-11-02', weekEnding: '2026-11-08', payDate: '2026-11-13', cutoffAt: '2026-11-09T04:59:59Z' }, state: 'approved', totals: { amount: p.total, people: 1 }, canApprove: true, blockedBy: null, needs: [], warnings: [], people: [p] } as unknown as PayWeek
    const people = new Map<string, ExportPerson>([[U, { userId: U, firstName: 'Jordan', lastName: 'Vale', email: 'j@x.co', employeeId: '77' }]])
    const adp = buildProviderExport({ provider: 'adp', week: w, people, adp: readAdpSettings({ payrollExport: { coCode: 'AB1' } }) })
    const cells = adp.csv.trim().split('\n')[1].split(',')
    expect(cells[8]).toBe('BON')
    expect(Number(cells[9])).toBe(0)
    expect(adp.csv).not.toMatch(/BON,-/)
  })
})
