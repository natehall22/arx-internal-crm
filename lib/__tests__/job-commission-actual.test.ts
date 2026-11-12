/** @jest-environment node */
/**
 * One commission number: the job Financials card and the Job profit tracker show what payroll paid / computes for the job
 * (lib/job-commission-actual.ts) — never 5/7/6/9% or the 18% pool typed into a screen. Golden jobs, integer cents.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

const mockPlan = jest.fn()
jest.mock('@/lib/payroll-period-materialization', () => ({ planPayrollPeriod: (...a: unknown[]) => mockPlan(...a) }))

import { jobProfitCents } from '@/lib/job-commission-actual-shared'
import { CommissionUnavailableError, loadJobCommissions } from '@/lib/job-commission-actual'

const ORG = 'org-a'
const NOW = new Date('2026-11-11T15:00:00Z') // a Wednesday

describe('jobProfitCents (golden)', () => {
  test('$16,325 job, $9,460 costs, payroll commission $2,938.50 → $3,926.50 (24.05%)', () => {
    const r = jobProfitCents({ saleCents: 1_632_500, directCostCents: 946_000, commissionCents: 293_850 })!
    expect(r.profitCents).toBe(392_650)
    expect(r.percent).toBeCloseTo(24.0521, 3)
  })
  test('the dealer fee is a direct cost, counted once: $18,400 job, $900 fee + $9,260 costs, $2,760 commission', () => {
    expect(jobProfitCents({ saleCents: 1_840_000, directCostCents: 90_000 + 926_000, commissionCents: 276_000 })!.profitCents).toBe(548_000)
  })
  test('unknown commission = no profit figure (never a guess); a $0 sale has no percent', () => {
    expect(jobProfitCents({ saleCents: 1_000_000, directCostCents: 0, commissionCents: null })).toBeNull()
    expect(jobProfitCents({ saleCents: 0, directCostCents: 0, commissionCents: 0 })).toEqual({ profitCents: 0, percent: null })
  })
})

describe('loadJobCommissions', () => {
  const schedule = { orgs: [{ id: ORG, timezone: 'America/New_York', settings: {} }] }
  beforeEach(() => mockPlan.mockReset())

  test('paid lines win and are summed to the cent; the planner only prices the rest', async () => {
    const db = createFakeDb({
      ...schedule,
      payroll_payout_lines: [
        { org_id: ORG, job_id: 'j1', net_amount: 735.5 },
        { org_id: ORG, job_id: 'j1', net_amount: 1029.7 },
        { org_id: ORG, job_id: 'j1', net_amount: 0.1 },
        { org_id: 'other', job_id: 'j1', net_amount: 999 },
      ],
    })
    mockPlan.mockResolvedValue({
      jobs: [{ job: { id: 'j2' }, rows: [{ net_amount: 500.25 }, { net_amount: 250.1 }] }],
      waiting: [{ job: { id: 'j3' }, rows: [{ net_amount: 100 }] }, { job: { id: 'j4' }, rows: [] }],
    })
    const m = await loadJobCommissions(db.client as never, ORG, ['j1', 'j2', 'j3', 'j4', 'j5'], NOW)
    expect(m.get('j1')).toEqual({ cents: 176530, source: 'paid' })
    expect(m.get('j2')).toEqual({ cents: 75035, source: 'planned' })
    expect(m.get('j3')).toEqual({ cents: 10000, source: 'estimate' })
    expect(m.has('j4')).toBe(false)
    expect(m.has('j5')).toBe(false)
    expect(mockPlan.mock.calls[0][1].onlyJobIds).toEqual(['j2', 'j3', 'j4', 'j5'])
    expect(mockPlan.mock.calls[0][1].simulate.includeSettledExternally).toBe(false)
  })

  test('all jobs paid: the planner is never run; a planner failure is an error, never a silent $0', async () => {
    const db = createFakeDb({ ...schedule, payroll_payout_lines: [{ org_id: ORG, job_id: 'j1', net_amount: 10 }] })
    await loadJobCommissions(db.client as never, ORG, ['j1'], NOW)
    expect(mockPlan).not.toHaveBeenCalled()
    mockPlan.mockRejectedValue(new Error('boom'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(loadJobCommissions(db.client as never, ORG, ['j1', 'j9'], NOW)).rejects.toBeInstanceOf(CommissionUnavailableError)
    spy.mockRestore()
  })

  test('commission-change fix lines (Payroll -> Fix a mistake) count in what was paid (applied only)', async () => {
    const db = createFakeDb({
      ...schedule,
      payroll_payout_lines: [{ org_id: ORG, job_id: 'j1', net_amount: 1000 }],
      payroll_adjustments: [
        { org_id: ORG, job_id: 'j1', kind: 'commission_change', amount: -250.25, status: 'applied' },
        { org_id: ORG, job_id: 'j1', kind: 'commission_change', amount: -77, status: 'pending' }, // not in an approved week yet: not paid
        { org_id: ORG, job_id: 'j1', kind: 'commission_change', amount: -999, status: 'void' },
        { org_id: ORG, job_id: 'j1', kind: 'bonus', amount: 500, status: 'applied' },
      ],
    })
    const m = await loadJobCommissions(db.client as never, ORG, ['j1'], NOW)
    expect(m.get('j1')).toEqual({ cents: 74975, source: 'paid' })
  })
})

describe('no hand-typed commission rates on the money screens', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8')
  test('tracker + Financials card carry no 5/7/6/9% math, no pool rate, no owner-draw ÷ 4, no dealer-fee-reduced base', () => {
    const tracker = read('app/admin/job-profit-tracker/page.tsx')
    expect(tracker).not.toMatch(/\*\s*0\.(05|07|06|09|2)\b/)
    expect(tracker).not.toMatch(/ownerDraw|perOwner/i)
    expect(tracker).not.toMatch(/saleAmount\s*-\s*financeCost/)
    const card = read('app/ops/jobs/[id]/JobDetailClient.tsx')
    expect(card).not.toContain('SALES_COMMISSION_POOL_RATE')
    expect(card).not.toContain('Net to ARX')
  })
})

describe('"Ready for payroll" is gone (payroll computes eligibility itself)', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8')
  test('no screen or route writes payroll_sent_at; payroll never reads it', () => {
    expect(read('app/api/ops/jobs/[id]/route.ts')).not.toMatch(/'payroll_sent_at',/)
    expect(read('app/ops/OpsClient.tsx')).not.toContain('Ready for payroll')
    for (const f of ['lib/payroll-period-materialization.ts', 'lib/payroll-pay-week.ts', 'lib/payroll-period-lock.ts', 'lib/legacy-payroll-materialization.ts']) {
      expect(read(f)).not.toContain('payroll_sent_at')
    }
  })
})
