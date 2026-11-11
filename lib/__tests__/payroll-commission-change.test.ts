/**
 * A time & materials job paid on an approved week, then more hours billed (and paid for), an invoice voided, or money refunded:
 * the paid week never changes; the next open week gets commission change lines = each person's PERCENT rate × the change in
 * the paid-for base. Flat dollars never scale. Refused during an approval → kept waiting and retried. Pay week switched off →
 * kept waiting and shown to owners. The SQL writer (payroll_add_commission_changes) is mirrored here (KR #38 pattern) and runs
 * on Postgres in supabase/tests/hourly_billing.test.sql.
 */
jest.mock('@/lib/payroll-periods', () => ({ ensureNextOpenPeriod: async () => ({ id: 'P2' }) }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import {
  loadCommissionChangesWaitingQueue,
  payableBaseFromFacts,
  percentRateOfLine,
  planCommissionChanges,
  retryDueCommissionChanges,
  syncCommissionChangesForJob,
  type PaidJobLine,
} from '@/lib/payroll-commission-change'
import { syncTimeAndMaterialsCommissionBase } from '@/lib/job-commission-base'
import { personTotalsFromTables } from '@/lib/payroll-week-total'
import { saveJobHourlySetup } from '@/lib/hourly-billing-db'

const ORG = 'org1'
const JOB = 'job-tm'
const CLOSER = 'u-closer'
const SETTER = 'u-setter'

const planLine = (rate: number, base: number, extra: Partial<PaidJobLine> = {}, flatBonus = 0, scaledNet?: number): PaidJobLine => {
  const total = Math.round(base * rate) / 100
  return {
    userId: CLOSER,
    gross: total + flatBonus,
    net: (scaledNet ?? total) + flatBonus,
    base,
    snapshot: { plan: { plan_type: 'percentage' }, calculation: { effectiveRate: rate, totalAmount: total } },
    periodId: 'P1',
    cutoffAt: 'x',
    ...extra,
  }
}

describe('only percentage pay scales', () => {
  it('rates per kind of line', () => {
    expect(percentRateOfLine(planLine(7, 10000))).toBeCloseTo(0.07)
    expect(percentRateOfLine(planLine(7, 10000, {}, 250))).toBeCloseTo(0.07) // a flat volume bonus never scales
    expect(percentRateOfLine(planLine(7, 10000, {}, 0, 650))).toBeCloseTo(0.065) // pool cap scaled it down: as paid
    expect(percentRateOfLine({ net: 500, gross: 500, base: 10000, snapshot: { basis: 'flat' } })).toBe(0) // Change-sheet $
    expect(percentRateOfLine({ net: 500, gross: 500, base: 10000, snapshot: { basis: 'percent' } })).toBeCloseTo(0.05)
    expect(percentRateOfLine({ net: 300, gross: 300, base: 10000, snapshot: { plan: { plan_type: 'flat_rate' }, calculation: { effectiveRate: 0, totalAmount: 300 } } })).toBe(0)
    expect(percentRateOfLine({ net: 300, gross: 300, base: 10000, snapshot: null })).toBe(0) // unknown shape: never pay on a guess
  })
  it('closer flat $500 on $10k → $14k = $0', () => {
    const paid = [{ userId: CLOSER, net: 500, gross: 500, base: 10000, snapshot: { basis: 'flat' }, periodId: 'P1', cutoffAt: 'x' }]
    expect(planCommissionChanges({ jobNumber: '1', currentBase: 14000, paid, prior: new Map() })).toEqual([])
  })
  it('closer 7% + $250 bonus, +$4k = +$280', () => {
    const lines = planCommissionChanges({ jobNumber: '26-0141', currentBase: 14000, paid: [planLine(7, 10000, {}, 250)], prior: new Map() })
    expect(lines).toEqual([
      { userId: CLOSER, baseDelta: 4000, amount: 280, expectedPrior: 0, reason: 'Commission change, job 26-0141: paid base $10,000.00 → $14,000.00 (+$4,000.00) × 7.0000% = $280.00' },
    ])
  })
  it('earlier change lines count as covered', () => {
    expect(planCommissionChanges({ jobNumber: null, currentBase: 14000, paid: [planLine(7, 10000)], prior: new Map([[CLOSER, 4000]]) })).toEqual([])
    expect(planCommissionChanges({ jobNumber: null, currentBase: 10000, paid: [planLine(7, 10000)], prior: new Map([[CLOSER, 4000]]) })[0]).toMatchObject({ baseDelta: -4000, amount: -280 })
  })
  it('the base follows money in: issued invoices × the share the payments cover', () => {
    expect(payableBaseFromFacts({ issuedTotalCents: 400000, issuedPreTaxCents: 400000 }, 100000)).toBe(1000)
    expect(payableBaseFromFacts({ issuedTotalCents: 428000, issuedPreTaxCents: 400000 }, 428000)).toBe(4000)
    expect(payableBaseFromFacts({ issuedTotalCents: 100000, issuedPreTaxCents: 100000 }, 500000)).toBe(1000) // capped
    expect(payableBaseFromFacts({ issuedTotalCents: 0, issuedPreTaxCents: 0 }, 500)).toBe(0)
  })
})

type Row = Record<string, unknown>
let claimed = false
let broken = false
function fakeAdd(args: Record<string, unknown>, t: Record<string, Row[]>) {
  if (claimed) throw Object.assign(new Error('being approved'), { code: '55006' })
  if (broken) throw Object.assign(new Error('connection reset'), { code: '08006' })
  const lines = args.p_lines as Row[]
  let n = 0
  for (const l of lines) {
    const prior = (t.payroll_adjustments ?? []).filter((a) => a.job_id === args.p_job && a.user_id === l.user_id && a.kind === 'commission_change' && a.status !== 'void').reduce((s, a) => s + Number(a.base_delta), 0)
    if (Math.round(prior * 100) !== Math.round(Number(l.expected_prior) * 100)) throw Object.assign(new Error('recompute'), { code: '40001' })
    ;(t.payroll_adjustments ??= []).push({ id: `adj${t.payroll_adjustments.length + 1}`, org_id: args.p_org, payroll_period_id: args.p_period, user_id: l.user_id, job_id: args.p_job, amount: l.amount, base_delta: l.base_delta, reason: l.reason, kind: 'commission_change', status: 'pending', source_period_id: args.p_source_period })
    n++
  }
  return n
}

function seed() {
  // Day 1: one $1,000 invoice, $1,000 paid; week P1 approved paid the closer 7% ($70, plan) + the setter 5% ($50, override).
  return createFakeDb(
    {
      production_jobs: [{ id: JOB, org_id: ORG, job_number: '26-0141', billing_mode: 'time_materials', sale_amount: 5000, commission_comp_base: 1000, commission_pre_tax_subtotal: null, project_id: null, commission_change_due_at: null, commission_change_wait: null }],
      job_invoices: [{ id: 'i1', org_id: ORG, job_id: JOB, status: 'paid', invoice_number: 'INV-1', total_cents: 100000, tax_cents: 0 }],
      job_payments: [{ id: 'pay1', job_id: JOB, amount_cents: 100000, funding_status: 'cleared' }],
      payroll_periods: [{ id: 'P1', org_id: ORG, status: 'paid', cutoff_at: '2026-11-08T04:59:59Z' }, { id: 'P2', org_id: ORG, status: 'open', cutoff_at: '2026-11-15T04:59:59Z' }],
      payroll_job_snapshots: [{ id: 's1', org_id: ORG, payroll_period_id: 'P1', job_id: JOB, commission_base: 1000 }],
      payroll_payout_lines: [
        { id: 'l1', org_id: ORG, payroll_period_id: 'P1', payroll_job_snapshot_id: 's1', job_id: JOB, user_id: CLOSER, participant_role: 'sales_rep', gross_amount: 70, net_amount: 70, comp_plan_snapshot: { plan: { plan_type: 'percentage' }, calculation: { effectiveRate: 7, totalAmount: 70 } } },
        { id: 'l2', org_id: ORG, payroll_period_id: 'P1', payroll_job_snapshot_id: 's1', job_id: JOB, user_id: SETTER, participant_role: 'setter', gross_amount: 50, net_amount: 50, comp_plan_snapshot: { basis: 'percent' } },
      ],
      payroll_adjustments: [],
      billed_time_days: [],
    },
    { rpc: { payroll_add_commission_changes: fakeAdd } }
  )
}
const lines = (db: ReturnType<typeof seed>) => db.tables.payroll_adjustments.map((a) => [a.user_id, a.amount, a.base_delta, a.payroll_period_id])
const addInvoice = (db: ReturnType<typeof seed>, id: string, cents: number, status = 'sent') => db.tables.job_invoices.push({ id, org_id: ORG, job_id: JOB, status, invoice_number: id, total_cents: cents, tax_cents: 0 })
const pay = (db: ReturnType<typeof seed>, id: string, cents: number) => db.tables.job_payments.push({ id, job_id: JOB, amount_cents: cents, funding_status: 'cleared' })

beforeEach(() => {
  claimed = false
  broken = false
  process.env.PAYROLL_PAY_WEEK_ENABLED = 'true'
})
afterAll(() => {
  delete process.env.PAYROLL_PAY_WEEK_ENABLED
})

describe('a T&M job billed more after it was paid', () => {
  it('day 1 $1k paid → days 2–5 +$3k: nothing until it is PAID, then commission on the $3k on the next open week', async () => {
    const db = seed()
    addInvoice(db, 'i2', 300000)
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(db.tables.production_jobs[0].commission_comp_base).toBe(4000) // issued, pre-tax
    expect(db.tables.payroll_adjustments).toEqual([]) // billed, not paid yet
    pay(db, 'pay2', 300000)
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2']])
    expect(db.tables.payroll_payout_lines.map((l) => l.net_amount)).toEqual([70, 50]) // the paid week never changes
    expect(personTotalsFromTables(db.tables, ORG, 'P2').get(CLOSER)).toBe(210)
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(db.tables.payroll_adjustments).toHaveLength(2) // again: nothing more
  })

  it('a paid invoice voided, or the money refunded → a negative line (clawback); negatives carry forward like any fix', async () => {
    const db = seed()
    addInvoice(db, 'i2', 300000)
    pay(db, 'pay2', 300000)
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    pay(db, 'refund', -300000)
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(lines(db).slice(2)).toEqual([[CLOSER, -210, -3000, 'P2'], [SETTER, -150, -3000, 'P2']])
    // Voiding the day-1 invoice too takes back what week P1 paid.
    db.tables.job_invoices[0].status = 'void'
    db.tables.job_invoices[1].status = 'void'
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(personTotalsFromTables(db.tables, ORG, 'P2').get(CLOSER)).toBe(-70)
    expect(personTotalsFromTables(db.tables, ORG, 'P2').get(SETTER)).toBe(-50)
  })

  it('refused while a week is being approved → kept waiting, retried later (never only logged)', async () => {
    const db = seed()
    addInvoice(db, 'i2', 300000)
    pay(db, 'pay2', 300000)
    claimed = true
    const r = await syncCommissionChangesForJob(db.client, ORG, JOB)
    expect(r.waiting).toBe('approval_running')
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_change_wait: 'approval_running' })
    expect(db.tables.payroll_adjustments).toEqual([])
    claimed = false
    expect(await retryDueCommissionChanges(db.client, ORG)).toMatchObject({ tried: 1, written: 1 })
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2']])
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_change_due_at: null, commission_change_wait: null })
  })

  it('an unexpected database error: the job is marked for retry (never only logged) and the morning retry writes it', async () => {
    const db = seed()
    addInvoice(db, 'i2', 300000)
    pay(db, 'pay2', 300000)
    broken = true
    await expect(syncCommissionChangesForJob(db.client, ORG, JOB)).rejects.toThrow('connection reset')
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_change_wait: 'retry_error' })
    expect(db.tables.production_jobs[0].commission_change_due_at).toBeTruthy()
    expect(await loadCommissionChangesWaitingQueue(db.client, ORG)).toMatchObject({ count: 1 })
    // The never-throws wrapper (invoice edits, approvals) marks it the same way.
    db.tables.production_jobs[0].commission_change_wait = null
    db.tables.production_jobs[0].commission_change_due_at = null
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_change_wait: 'retry_error' })
    // Still broken in the morning: stays waiting.
    expect(await retryDueCommissionChanges(db.client, ORG)).toMatchObject({ tried: 1, written: 0, waiting: 1 })
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_change_wait: 'retry_error' })
    broken = false
    expect(await retryDueCommissionChanges(db.client, ORG)).toMatchObject({ tried: 1, written: 1 })
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2']])
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_change_due_at: null, commission_change_wait: null })
  })

  it('a fixed-price job marked for retry is only un-marked (its base is never re-synced from the retry)', async () => {
    const db = seed()
    db.tables.production_jobs[0].billing_mode = null
    db.tables.production_jobs[0].commission_change_wait = 'retry_error'
    db.tables.production_jobs[0].commission_change_due_at = '2026-11-10T10:00:00Z'
    await retryDueCommissionChanges(db.client, ORG)
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_comp_base: 1000, commission_change_wait: null, commission_change_due_at: null })
  })

  it('new pay week switched off (legacy payroll): no lines written — kept waiting and shown to owners', async () => {
    const db = seed()
    delete process.env.PAYROLL_PAY_WEEK_ENABLED
    addInvoice(db, 'i2', 300000)
    pay(db, 'pay2', 300000)
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(db.tables.payroll_adjustments).toEqual([])
    expect(db.tables.production_jobs[0]).toMatchObject({ commission_change_wait: 'pay_week_off' })
    expect(await loadCommissionChangesWaitingQueue(db.client, ORG)).toMatchObject({ title: '1 commission change waiting for the new payroll', count: 1 })
    process.env.PAYROLL_PAY_WEEK_ENABLED = 'true'
    await retryDueCommissionChanges(db.client, ORG)
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2']])
    expect(await loadCommissionChangesWaitingQueue(db.client, ORG)).toBeNull()
  })

  it('not paid on an approved week yet: no lines — the week that pays it uses the current base', async () => {
    const db = seed()
    db.tables.payroll_periods[0].status = 'open'
    addInvoice(db, 'i2', 300000)
    pay(db, 'pay2', 300000)
    expect(await syncCommissionChangesForJob(db.client, ORG, JOB)).toMatchObject({ added: 0, waiting: null })
  })

  it('a concurrent run is refused by the "base covered" check and recomputed (never paid twice)', async () => {
    const db = seed()
    addInvoice(db, 'i2', 300000)
    pay(db, 'pay2', 300000)
    db.tables.payroll_adjustments.push({ id: 'x', org_id: ORG, payroll_period_id: 'P2', user_id: CLOSER, job_id: JOB, amount: 210, base_delta: 3000, kind: 'commission_change', status: 'pending' })
    await syncCommissionChangesForJob(db.client, ORG, JOB)
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2']])
  })

  it('once paid, the job can’t switch between by-the-hour and as-sold', async () => {
    const db = seed()
    expect(await saveJobHourlySetup(db.client, ORG, JOB, { mode: 'fixed', estimatedHours: null, rateItemId: null })).toMatchObject({ ok: false, status: 409 })
  })
})
