/**
 * A time & materials job paid on an approved week, then billed more (or an invoice voided): the paid week never changes;
 * the next open week gets commission change lines (+ or −) = base change × each person's paid share, math in the reason.
 * Re-running writes nothing. The SQL writer (payroll_add_commission_changes) is mirrored here (KR #38 pattern) and runs on
 * Postgres in supabase/tests/hourly_billing.test.sql.
 */
jest.mock('@/lib/payroll-periods', () => ({ ensureNextOpenPeriod: async () => ({ id: 'P2' }) }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { planCommissionChanges, syncCommissionChangesForJob } from '@/lib/payroll-commission-change'
import { syncTimeAndMaterialsCommissionBase } from '@/lib/job-commission-base'
import { personTotalsFromTables } from '@/lib/payroll-week-total'
import { saveJobHourlySetup } from '@/lib/hourly-billing-db'

const ORG = 'org1'
const JOB = 'job-tm'
const CLOSER = 'u-closer'
const SETTER = 'u-setter'

type Row = Record<string, unknown>
function fakeAdd(args: Record<string, unknown>, t: Record<string, Row[]>) {
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
  // Day 1: one $1,000 invoice (sent), paid in full; week P1 approved paid closer 7% ($70) + setter 5% ($50) on base $1,000.
  return createFakeDb(
    {
      production_jobs: [{ id: JOB, org_id: ORG, job_number: '26-0141', billing_mode: 'time_materials', sale_amount: 5000, commission_comp_base: 1000, commission_pre_tax_subtotal: null, project_id: null }],
      job_invoices: [{ id: 'i1', org_id: ORG, job_id: JOB, status: 'paid', invoice_number: 'INV-1', total_cents: 100000, tax_cents: 0 }],
      payroll_periods: [{ id: 'P1', org_id: ORG, status: 'paid', cutoff_at: '2026-11-08T04:59:59Z' }, { id: 'P2', org_id: ORG, status: 'open', cutoff_at: '2026-11-15T04:59:59Z' }],
      payroll_job_snapshots: [{ id: 's1', org_id: ORG, payroll_period_id: 'P1', job_id: JOB, commission_base: 1000 }],
      payroll_payout_lines: [
        { id: 'l1', org_id: ORG, payroll_period_id: 'P1', payroll_job_snapshot_id: 's1', job_id: JOB, user_id: CLOSER, participant_role: 'sales_rep', net_amount: 70 },
        { id: 'l2', org_id: ORG, payroll_period_id: 'P1', payroll_job_snapshot_id: 's1', job_id: JOB, user_id: SETTER, participant_role: 'setter', net_amount: 50 },
      ],
      payroll_adjustments: [],
      billed_time_days: [],
    },
    { rpc: { payroll_add_commission_changes: fakeAdd } }
  )
}
const lines = (db: ReturnType<typeof seed>) => db.tables.payroll_adjustments.map((a) => [a.user_id, a.amount, a.base_delta, a.payroll_period_id])

describe('commission change lines (pure)', () => {
  it('base change × paid share; nothing when in step; prior changes counted', () => {
    const paid = [{ userId: CLOSER, net: 70, base: 1000, periodId: 'P1', cutoffAt: 'x' }]
    expect(planCommissionChanges({ jobNumber: '26-0141', currentBase: 4000, paid, prior: new Map() })).toEqual([
      { userId: CLOSER, baseDelta: 3000, amount: 210, expectedPrior: 0, reason: 'Commission change, job 26-0141: base $1,000.00 → $4,000.00 (+$3,000.00) × 7.0000% = $210.00' },
    ])
    expect(planCommissionChanges({ jobNumber: null, currentBase: 4000, paid, prior: new Map([[CLOSER, 3000]]) })).toEqual([])
    expect(planCommissionChanges({ jobNumber: '1', currentBase: 3000, paid, prior: new Map([[CLOSER, 3000]]) })[0]).toMatchObject({ baseDelta: -1000, amount: -70 })
    expect(planCommissionChanges({ jobNumber: '1', currentBase: 0, paid: [{ ...paid[0], base: 0 }], prior: new Map() })).toEqual([])
  })
})

describe('a T&M job billed more / voided after it was paid', () => {
  it('day 1 $1k paid → days 2–5 +$3k → next open week pays commission on the $3k; the paid week is untouched', async () => {
    const db = seed()
    db.tables.job_invoices.push({ id: 'i2', org_id: ORG, job_id: JOB, status: 'sent', invoice_number: 'INV-2', total_cents: 300000, tax_cents: 0 })
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(db.tables.production_jobs[0].commission_comp_base).toBe(4000)
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2']])
    expect(db.tables.payroll_adjustments[0].reason).toContain('× 7.0000% = $210.00')
    // The paid week's lines and snapshot never change.
    expect(db.tables.payroll_payout_lines.map((l) => l.net_amount)).toEqual([70, 50])
    // Counted on the open week's check through the one week-total definition.
    expect(personTotalsFromTables(db.tables, ORG, 'P2').get(CLOSER)).toBe(210)
    // Again: nothing more.
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(db.tables.payroll_adjustments).toHaveLength(2)
  })

  it('a draft invoice adds nothing until it is sent', async () => {
    const db = seed()
    db.tables.job_invoices.push({ id: 'i2', org_id: ORG, job_id: JOB, status: 'draft', invoice_number: 'INV-2', total_cents: 300000, tax_cents: 0 })
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(db.tables.production_jobs[0].commission_comp_base).toBe(1000)
    expect(db.tables.payroll_adjustments).toEqual([])
  })

  it('voided after payroll: a negative line (clawback) on the next open week', async () => {
    const db = seed()
    db.tables.job_invoices.push({ id: 'i2', org_id: ORG, job_id: JOB, status: 'sent', invoice_number: 'INV-2', total_cents: 300000, tax_cents: 0 })
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    db.tables.job_invoices[1].status = 'void'
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2'], [CLOSER, -210, -3000, 'P2'], [SETTER, -150, -3000, 'P2']])
    expect(personTotalsFromTables(db.tables, ORG, 'P2').get(CLOSER)).toBe(0)
    // Voiding the day-1 invoice too takes back what week P1 paid (carried forward at approve if the check goes below $0).
    db.tables.job_invoices[0].status = 'void'
    await syncTimeAndMaterialsCommissionBase(db.client, ORG, JOB)
    expect(personTotalsFromTables(db.tables, ORG, 'P2').get(CLOSER)).toBe(-70)
    expect(personTotalsFromTables(db.tables, ORG, 'P2').get(SETTER)).toBe(-50)
  })

  it('not paid yet (no approved week): no lines — the week that pays it uses the current base', async () => {
    const db = seed()
    db.tables.payroll_periods[0].status = 'open'
    db.tables.job_invoices.push({ id: 'i2', org_id: ORG, job_id: JOB, status: 'sent', invoice_number: 'INV-2', total_cents: 300000, tax_cents: 0 })
    expect(await syncCommissionChangesForJob(db.client, ORG, JOB)).toMatchObject({ added: 0 })
  })

  it('a concurrent run is refused by the "base covered" check and recomputed (never paid twice)', async () => {
    const db = seed()
    db.tables.job_invoices.push({ id: 'i2', org_id: ORG, job_id: JOB, status: 'sent', invoice_number: 'INV-2', total_cents: 300000, tax_cents: 0 })
    db.tables.production_jobs[0].commission_comp_base = 4000
    // Someone else's run already wrote the closer's line.
    db.tables.payroll_adjustments.push({ id: 'x', org_id: ORG, payroll_period_id: 'P2', user_id: CLOSER, job_id: JOB, amount: 210, base_delta: 3000, kind: 'commission_change', status: 'pending' })
    await syncCommissionChangesForJob(db.client, ORG, JOB)
    expect(lines(db)).toEqual([[CLOSER, 210, 3000, 'P2'], [SETTER, 150, 3000, 'P2']])
  })

  it('once paid, the job can’t switch between by-the-hour and as-sold', async () => {
    const db = seed()
    expect(await saveJobHourlySetup(db.client, ORG, JOB, { mode: 'fixed', estimatedHours: null, rateItemId: null })).toMatchObject({ ok: false, status: 409 })
  })
})
