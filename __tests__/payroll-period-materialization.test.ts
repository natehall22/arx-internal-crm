import { derivePayrollEligibility } from '@/lib/payroll-period-materialization'

const job = {
  id: 'job-1',
  job_number: '26-0033',
  status: 'collected',
  sale_date: '2026-07-14',
  sale_amount: 6622.79,
  commission_comp_base: 4637.27,
  commission_pre_tax_subtotal: 5630.03,
  dealer_fee_amount: 992.76,
  salesperson_id: 'salesperson-1',
  project_id: 'project-1',
  completed_at: '2026-07-24T01:00:21.643Z',
  allow_close_with_balance: false,
}

describe('derivePayrollEligibility', () => {
  it('makes an installed, fully cleared job with approved costs payable', () => {
    const result = derivePayrollEligibility({
      job,
      payments: [
        {
          job_id: job.id,
          amount_cents: 662279,
          funding_status: 'cleared',
          paid_at: '2026-07-24',
          created_at: '2026-07-24T01:00:14.609Z',
        },
      ],
      costs: [
        {
          job_id: job.id,
          amount: 992.76,
          approved: true,
          deduct_from_commission_base: true,
          created_at: '2026-07-14T00:14:45.023Z',
          updated_at: '2026-07-14T00:14:45.023Z',
        },
      ],
    })

    expect(result).toEqual({
      eligibleAt: '2026-07-24T01:00:21.643Z',
      reason: null,
      deductibleCosts: 992.76,
    })
  })

  it('fails closed when cleared funding is short', () => {
    const result = derivePayrollEligibility({
      job,
      payments: [
        {
          job_id: job.id,
          amount_cents: 10000,
          funding_status: 'cleared',
          paid_at: '2026-07-24',
          created_at: '2026-07-24T01:00:14.609Z',
        },
      ],
      costs: [],
    })

    expect(result.reason).toBe('not_funded')
    expect(result.eligibleAt).toBeNull()
  })

  it('does not count pending payments', () => {
    const result = derivePayrollEligibility({
      job,
      payments: [
        {
          job_id: job.id,
          amount_cents: 662279,
          funding_status: 'pending',
          paid_at: '2026-07-24',
          created_at: '2026-07-24T01:00:14.609Z',
        },
      ],
      costs: [],
    })

    expect(result.reason).toBe('not_funded')
  })

  it('blocks unapproved commission deductions', () => {
    const result = derivePayrollEligibility({
      job,
      payments: [
        {
          job_id: job.id,
          amount_cents: 662279,
          funding_status: 'cleared',
          paid_at: '2026-07-24',
          created_at: '2026-07-24T01:00:14.609Z',
        },
      ],
      costs: [
        {
          job_id: job.id,
          amount: 100,
          approved: false,
          deduct_from_commission_base: true,
          created_at: '2026-07-24T01:00:00.000Z',
          updated_at: '2026-07-24T01:00:00.000Z',
        },
      ],
    })

    expect(result.reason).toBe('missing_costs')
  })
})

describe('derivePayrollEligibility — paid-in-full rule (lib/job-collection.ts)', () => {
  const pay = (cents: number) => ({
    job_id: job.id,
    amount_cents: cents,
    funding_status: 'cleared',
    paid_at: '2026-07-24',
    created_at: '2026-07-24T01:00:14.609Z',
  })
  it('within $0.05 short is funded', () => {
    expect(derivePayrollEligibility({ job, payments: [pay(662275)], costs: [] }).reason).toBeNull()
  })
  it('a legacy close-with-balance flag no longer counts as funded', () => {
    const r = derivePayrollEligibility({
      job: { ...job, allow_close_with_balance: true, close_balance_by: null },
      payments: [pay(10000)],
      costs: [],
    })
    expect(r.reason).toBe('not_funded')
  })
  it('a super-admin force counts, dated when it was forced', () => {
    const r = derivePayrollEligibility({
      job: { ...job, allow_close_with_balance: true, close_balance_by: 'owner', close_balance_at: '2026-07-30T00:00:00.000Z' },
      payments: [],
      costs: [],
    })
    expect(r.reason).toBeNull()
    expect(r.eligibleAt).toBe('2026-07-30T00:00:00.000Z')
  })
  it('a job with no sale amount is not funded', () => {
    expect(derivePayrollEligibility({ job: { ...job, sale_amount: null }, payments: [], costs: [] }).reason).toBe('not_funded')
  })
})
