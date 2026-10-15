import { allocateOverhead, businessDateKey, completionMonthKey } from '@/lib/reporting/overhead-allocation'

const sum = (m: Map<string, number>) => Math.round(Array.from(m.values()).reduce((s, v) => s + v, 0) * 100) / 100

describe('businessDateKey / completionMonthKey', () => {
  it('keeps a bare DATE as-is (no UTC-midnight shift)', () => {
    expect(businessDateKey('2026-09-30')).toBe('2026-09-30')
    expect(completionMonthKey('2026-09-30')).toBe('2026-09')
  })

  it('maps a UTC timestamp late on the last day of month (Eastern) to that month', () => {
    // 2026-10-01T01:30Z = 2026-09-30 21:30 EDT
    expect(businessDateKey('2026-10-01T01:30:00Z')).toBe('2026-09-30')
    expect(completionMonthKey('2026-10-01T01:30:00Z')).toBe('2026-09')
  })

  it('keeps a mid-day UTC timestamp on the same Eastern day', () => {
    expect(completionMonthKey('2026-10-01T15:00:00Z')).toBe('2026-10')
  })

  it('handles standard time (EST, UTC-5)', () => {
    expect(businessDateKey('2026-01-01T03:00:00Z')).toBe('2025-12-31')
  })

  it('falls back to the first 10 chars for an unparseable value', () => {
    expect(businessDateKey('not-a-date-at-all')).toBe('not-a-date')
  })
})

describe('allocateOverhead', () => {
  it('splits $1,200 across 5 jobs as $240 each', () => {
    const jobs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, completed_at: '2026-09-15' }))
    const r = allocateOverhead(jobs, { '2026-09': 1200 })
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(r.byJob.get(id)).toBe(240)
    expect(r.byMonth.get('2026-09')).toEqual({ overhead: 1200, jobs: 5, perJob: 240 })
    expect(r.unallocatedMonths).toEqual([])
  })

  it('distributes cents so $1,000 over 3 jobs sums exactly', () => {
    const jobs = ['c', 'a', 'b'].map((id) => ({ id, completed_at: '2026-09-10' }))
    const r = allocateOverhead(jobs, { '2026-09': 1000 })
    expect(sum(r.byJob)).toBe(1000)
    // first jobs in id order take the leftover cent
    expect(r.byJob.get('a')).toBe(333.34)
    expect(r.byJob.get('b')).toBe(333.33)
    expect(r.byJob.get('c')).toBe(333.33)
    expect(r.byMonth.get('2026-09')?.perJob).toBe(333.33)
  })

  it('distributes multiple leftover cents ($0.05 over 3 jobs)', () => {
    const jobs = ['a', 'b', 'c'].map((id) => ({ id, completed_at: '2026-09-10' }))
    const r = allocateOverhead(jobs, { '2026-09': 0.05 })
    expect(r.byJob.get('a')).toBe(0.02)
    expect(r.byJob.get('b')).toBe(0.02)
    expect(r.byJob.get('c')).toBe(0.01)
    expect(sum(r.byJob)).toBe(0.05)
  })

  it('handles negative overhead (credit) while still summing exactly', () => {
    const jobs = ['a', 'b', 'c'].map((id) => ({ id, completed_at: '2026-09-10' }))
    const r = allocateOverhead(jobs, { '2026-09': -1000 })
    expect(sum(r.byJob)).toBe(-1000)
  })

  it('flags a month with overhead but no completed jobs as unallocated', () => {
    const r = allocateOverhead([{ id: 'a', completed_at: '2026-09-10' }], { '2026-09': 100, '2026-08': 500 })
    expect(r.unallocatedMonths).toEqual(['2026-08'])
    expect(r.byMonth.get('2026-08')).toEqual({ overhead: 500, jobs: 0, perJob: 0 })
    expect(r.byJob.get('a')).toBe(100)
  })

  it('does not flag a zero-overhead month with no jobs', () => {
    const r = allocateOverhead([], { '2026-08': 0 })
    expect(r.unallocatedMonths).toEqual([])
  })

  it('sorts unallocatedMonths', () => {
    const r = allocateOverhead([], { '2026-10': 5, '2026-02': 5, '2026-07': 5 })
    expect(r.unallocatedMonths).toEqual(['2026-02', '2026-07', '2026-10'])
  })

  it('assigns by Eastern business month for timestamps', () => {
    const jobs = [
      { id: 'sep', completed_at: '2026-10-01T01:30:00Z' },
      { id: 'oct', completed_at: '2026-10-01T15:00:00Z' },
    ]
    const r = allocateOverhead(jobs, { '2026-09': 100, '2026-10': 200 })
    expect(r.byJob.get('sep')).toBe(100)
    expect(r.byJob.get('oct')).toBe(200)
  })

  it('keeps a bare DATE 2026-09-30 in September', () => {
    const r = allocateOverhead([{ id: 'x', completed_at: '2026-09-30' }], { '2026-09': 50, '2026-08': 70 })
    expect(r.byJob.get('x')).toBe(50)
    expect(r.unallocatedMonths).toEqual(['2026-08'])
  })

  it('ignores jobs without completed_at (not in byJob)', () => {
    const r = allocateOverhead([{ id: 'a', completed_at: null }, { id: 'b', completed_at: '2026-09-01' }], { '2026-09': 100 })
    expect(r.byJob.has('a')).toBe(false)
    expect(r.byJob.get('b')).toBe(100)
  })

  it('gives completed jobs in months with no recorded overhead an explicit 0', () => {
    const r = allocateOverhead([{ id: 'a', completed_at: '2026-09-01' }], {})
    expect(r.byJob.get('a')).toBe(0)
  })

  it('accepts a Map for overheadByMonth', () => {
    const r = allocateOverhead([{ id: 'a', completed_at: '2026-09-01' }], new Map([['2026-09', 75.5]]))
    expect(r.byJob.get('a')).toBe(75.5)
  })

  it('rounds the monthly overhead to cents first', () => {
    const r = allocateOverhead([{ id: 'a', completed_at: '2026-09-01' }], { '2026-09': 10.004 })
    expect(r.byMonth.get('2026-09')?.overhead).toBe(10)
    expect(r.byJob.get('a')).toBe(10)
  })
})
