import { addMonths, computeEarnIn, wholeMonthsBetween, EARN_IN_TERMS, type EarnInJob } from '@/lib/reporting/partner-earn-in'

const job = (id: string, completedAt: string, revenue: number): EarnInJob => ({ id, completedAt, revenue })

describe('addMonths', () => {
  it('clamps Jan 31 + 1 month to Feb 28 / Feb 29', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
  it('rolls over years', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-09-14', 18)).toBe('2028-03-14')
    expect(addMonths('2026-03-10', 12)).toBe('2027-03-10')
  })
  it('supports 0 and negative months', () => {
    expect(addMonths('2026-05-31', 0)).toBe('2026-05-31')
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })
  it('clamps 31st to 30-day months', () => {
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })
})

describe('wholeMonthsBetween', () => {
  it('counts a month only once its anniversary is reached', () => {
    expect(wholeMonthsBetween('2026-09-14', '2026-10-13')).toBe(0)
    expect(wholeMonthsBetween('2026-09-14', '2026-10-14')).toBe(1)
    expect(wholeMonthsBetween('2026-09-14', '2027-09-14')).toBe(12)
  })
  it('returns 0 when to < from or equal', () => {
    expect(wholeMonthsBetween('2026-09-14', '2026-01-01')).toBe(0)
    expect(wholeMonthsBetween('2026-09-14', '2026-09-14')).toBe(0)
  })
  it('uses clamped anniversaries for end-of-month starts', () => {
    expect(wholeMonthsBetween('2026-01-31', '2026-02-27')).toBe(0)
    expect(wholeMonthsBetween('2026-01-31', '2026-02-28')).toBe(1)
  })
})

describe('computeEarnIn stage 1', () => {
  const startDate = '2026-09-14'

  it('vests on the later of service mark and revenue mark: service mark later', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2028-06-01',
      qualifyingJobs: [job('q1', '2027-01-10', 2_500_000)],
      companyJobs: [],
    })
    expect(r.stage1.serviceMarkOn).toBe('2028-03-14')
    expect(r.stage1.revenueMarkOn).toBe('2027-01-10')
    expect(r.stage1.vestedOn).toBe('2028-03-14')
    expect(r.vestedPct).toBe(18)
    expect(r.stage2.eligible).toBe(true)
  })

  it('vests on the later of service mark and revenue mark: revenue mark later', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2028-06-01',
      qualifyingJobs: [job('q1', '2027-06-01', 1_000_000), job('q2', '2028-05-01', 1_500_000)],
      companyJobs: [],
    })
    expect(r.stage1.revenueMarkOn).toBe('2028-05-01')
    expect(r.stage1.vestedOn).toBe('2028-05-01')
    expect(r.vestedPct).toBe(18)
  })

  it('nothing vests before 18 months, even with $3M of qualifying revenue', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2027-03-14', // exactly 6 months in
      qualifyingJobs: [job('q1', '2026-12-01', 3_000_000)],
      companyJobs: [job('q1', '2026-12-01', 3_000_000)],
    })
    expect(r.monthsServed).toBe(6)
    expect(r.stage1.vestedOn).toBeNull()
    expect(r.stage1.revenueMarkOn).toBe('2026-12-01')
    expect(r.vestedPct).toBe(0)
    expect(r.stage2.eligible).toBe(false)
    expect(r.stage2.vestedOn).toBeNull()
    expect(r.stage1.timeProgress).toBe(0.3333)
    expect(r.stage1.revenueProgress).toBe(1)
    expect(r.saleCreditPct).toBe(6) // min(1/3, 1) * 18
  })

  it('does not vest when the service mark is reached but revenue is short', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2028-06-01',
      qualifyingJobs: [job('q1', '2027-06-01', 2_499_999.99)],
      companyJobs: [],
    })
    expect(r.stage1.vestedOn).toBeNull()
    expect(r.stage1.revenueMarkOn).toBeNull()
    expect(r.vestedPct).toBe(0)
  })

  it('treats the service mark date itself as reached (asOf == mark)', () => {
    const r = computeEarnIn({ startDate, asOf: '2028-03-14', qualifyingJobs: [job('q1', '2027-01-10', 2_500_000)], companyJobs: [] })
    expect(r.stage1.vestedOn).toBe('2028-03-14')
  })

  it('ignores jobs completed after asOf', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2028-06-01',
      qualifyingJobs: [job('q1', '2027-01-10', 1_000_000), job('late', '2028-06-02', 5_000_000)],
      companyJobs: [],
    })
    expect(r.qualifyingRevenue).toBe(1_000_000)
    expect(r.stage1.vestedOn).toBeNull()
  })

  it('normalizes UTC timestamps to the Eastern business date', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2028-06-01',
      // 2027-01-11T02:00Z is 2027-01-10 21:00 EST
      qualifyingJobs: [job('q1', '2027-01-11T02:00:00Z', 2_500_000)],
      companyJobs: [],
    })
    expect(r.stage1.revenueMarkOn).toBe('2027-01-10')
  })

  it('a job dated exactly asOf counts', () => {
    const r = computeEarnIn({ startDate, asOf: '2027-01-10', qualifyingJobs: [job('q1', '2027-01-10', 500)], companyJobs: [] })
    expect(r.qualifyingRevenue).toBe(500)
  })
})

describe('computeEarnIn stage 2', () => {
  const startDate = '2026-09-14'
  // Stage 1 vests 2028-03-14 (service mark); revenue mark 2027-01-10.
  const q0 = job('q0', '2027-01-10', 2_500_000)

  it('revenue after the $2.5M crossing is NOT stage-1 revenue, so it counts toward stage 2 (even on the vesting date)', () => {
    const extra = job('extra', '2028-03-14', 3_000_000) // q0 already crossed $2.5M; this job was not needed for benchmark 1
    const r = computeEarnIn({ startDate, asOf: '2028-09-01', qualifyingJobs: [q0, extra], companyJobs: [q0, extra] })
    expect(r.stage1.vestedOn).toBe('2028-03-14')
    expect(r.stage2.vestedOn).toBe('2028-03-14')
    expect(r.vestedPct).toBe(25)
  })

  it('excludes the job that crossed $2.5M from stage 2 when vesting happens on its completion date', () => {
    const small = job('small', '2027-01-01', 100_000)
    const crossing = job('crossing', '2028-05-01', 3_000_000) // crosses $2.5M after the 18-month mark → vest date
    const fresh = job('fresh', '2028-06-01', 3_000_000)
    const r = computeEarnIn({ startDate, asOf: '2028-09-01', qualifyingJobs: [small, crossing], companyJobs: [small, crossing, fresh] })
    expect(r.stage1.vestedOn).toBe('2028-05-01')
    expect(r.stage2.bestWindowRevenue).toBe(3_000_000)
    expect(r.stage2.bestWindowStart).toBe('2028-06-01')
    expect(r.stage2.vestedOn).toBe('2028-06-01')
    expect(r.stage2.postVestingRevenue).toBe(3_000_000)
    expect(r.saleCreditPct).toBe(25)
  })

  it('dedupes shared jobs and ignores jobs completed before the start date', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2027-01-01',
      qualifyingJobs: [job('pre', '2026-09-01', 100), job('a', '2026-12-01', 50), job('a', '2026-12-01', 50)],
      companyJobs: [],
    })
    expect(r.qualifyingRevenue).toBe(50)
  })

  it('does NOT vest when two $1.6M halves are 13 months apart', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2029-06-01',
      qualifyingJobs: [q0],
      companyJobs: [job('c1', '2028-04-01', 1_600_000), job('c2', '2029-05-01', 1_600_000)],
    })
    expect(r.stage1.vestedOn).toBe('2028-03-14')
    expect(r.stage2.vestedOn).toBeNull()
    expect(r.stage2.bestWindowRevenue).toBe(1_600_000)
    expect(r.vestedPct).toBe(18)
  })

  it('vests when the two $1.6M halves are within the same 12-month window', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2029-06-01',
      qualifyingJobs: [q0],
      companyJobs: [job('c1', '2028-04-01', 1_600_000), job('c2', '2029-03-31', 1_600_000)],
    })
    expect(r.stage2.vestedOn).toBe('2029-03-31')
    expect(r.stage2.bestWindowRevenue).toBe(3_200_000)
    expect(r.stage2.bestWindowStart).toBe('2028-04-01')
    expect(r.vestedPct).toBe(25)
  })

  it('a job exactly 12 months after the window start falls outside it', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2029-06-01',
      qualifyingJobs: [q0],
      companyJobs: [job('c1', '2028-04-01', 1_600_000), job('c2', '2029-04-01', 1_600_000)],
    })
    expect(r.stage2.vestedOn).toBeNull()
  })

  it('ignores company jobs before the vesting date', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2028-09-01',
      qualifyingJobs: [q0],
      companyJobs: [job('pre', '2028-03-01', 5_000_000)],
    })
    expect(r.stage2.bestWindowRevenue).toBe(0)
    expect(r.stage2.vestedOn).toBeNull()
  })

  it('ignores company jobs after asOf', () => {
    const r = computeEarnIn({
      startDate,
      asOf: '2028-09-01',
      qualifyingJobs: [q0],
      companyJobs: [job('post', '2028-09-02', 5_000_000)],
    })
    expect(r.stage2.vestedOn).toBeNull()
  })

  it('reports months since vesting', () => {
    const r = computeEarnIn({ startDate, asOf: '2028-09-14', qualifyingJobs: [q0], companyJobs: [] })
    expect(r.stage2.monthsSinceVesting).toBe(6)
  })
})

describe('computeEarnIn saleCreditPct (Section 7 worked examples)', () => {
  it('example 1: 12 months and $1,500,000 -> 10.8%', () => {
    const r = computeEarnIn({
      startDate: '2026-09-14',
      asOf: '2027-09-14',
      qualifyingJobs: [job('q1', '2027-03-01', 1_500_000)],
      companyJobs: [],
    })
    expect(r.monthsServed).toBe(12)
    expect(r.stage1.timeProgress).toBe(0.6667)
    expect(r.stage1.revenueProgress).toBe(0.6)
    expect(r.vestedPct).toBe(0)
    expect(r.saleCreditPct).toBe(10.8)
  })

  it('example 2: after the 18% vests, 6 months and $2,100,000 -> 3.5% more, 21.5% total', () => {
    const r = computeEarnIn({
      startDate: '2026-09-14',
      asOf: '2028-09-14', // stage 1 vested 2028-03-14 -> 6 months since
      qualifyingJobs: [job('q0', '2027-01-10', 2_500_000)],
      companyJobs: [job('c1', '2028-04-01', 1_000_000), job('c2', '2028-07-01', 1_100_000)],
    })
    expect(r.stage1.vestedOn).toBe('2028-03-14')
    expect(r.stage2.monthsSinceVesting).toBe(6)
    expect(r.stage2.bestWindowRevenue).toBe(2_100_000)
    expect(r.stage2.vestedOn).toBeNull()
    expect(r.vestedPct).toBe(18)
    expect(r.saleCreditPct).toBe(21.5)
  })

  it('uses the lower of time and revenue progress (revenue lower in stage 2)', () => {
    const r = computeEarnIn({
      startDate: '2026-09-14',
      asOf: '2029-03-14', // 12 months since vesting -> time 100%
      qualifyingJobs: [job('q0', '2027-01-10', 2_500_000)],
      companyJobs: [job('c1', '2028-04-01', 1_500_000)],
    })
    expect(r.saleCreditPct).toBe(18 + 0.5 * 7) // 21.5
  })

  it('fully vested credit is 25%', () => {
    const r = computeEarnIn({
      startDate: '2026-09-14',
      asOf: '2029-06-01',
      qualifyingJobs: [job('q0', '2027-01-10', 2_500_000)],
      companyJobs: [job('c1', '2028-04-01', 3_000_000)],
    })
    expect(r.saleCreditPct).toBe(25)
  })

  it('zero progress at the start date', () => {
    const r = computeEarnIn({ startDate: '2026-09-14', asOf: '2026-09-14', qualifyingJobs: [], companyJobs: [] })
    expect(r.monthsServed).toBe(0)
    expect(r.saleCreditPct).toBe(0)
    expect(r.vestedPct).toBe(0)
  })

  it('honors custom terms', () => {
    const r = computeEarnIn({
      startDate: '2026-01-01',
      asOf: '2026-07-01',
      qualifyingJobs: [job('q', '2026-03-01', 500)],
      companyJobs: [],
      terms: { ...EARN_IN_TERMS, stage1Months: 6, stage1Revenue: 1000, stage1Pct: 10 } as unknown as typeof EARN_IN_TERMS,
    })
    expect(r.stage1.vestedOn).toBeNull()
    expect(r.saleCreditPct).toBe(5) // min(1, .5) * 10
  })
})
