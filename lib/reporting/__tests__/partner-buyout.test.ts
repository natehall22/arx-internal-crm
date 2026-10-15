import { computeBuyout, splitInstallments } from '@/lib/reporting/partner-buyout'

describe('splitInstallments', () => {
  it('splits evenly when divisible', () => {
    expect(splitInstallments(1000, 4)).toEqual([250, 250, 250, 250])
  })

  it('puts leftover cents on the first payments (1000.01 / 2)', () => {
    const out = splitInstallments(1000.01, 2)
    expect(out).toEqual([500.01, 500])
    expect(Math.round(out.reduce((s, v) => s + v, 0) * 100) / 100).toBe(1000.01)
  })

  it('always sums exactly (10000 / 3)', () => {
    const out = splitInstallments(10000, 3)
    expect(out).toEqual([3333.34, 3333.33, 3333.33])
    expect(Math.round(out.reduce((s, v) => s + v, 0) * 100) / 100).toBe(10000)
  })

  it('handles a single installment', () => {
    expect(splitInstallments(123.45, 1)).toEqual([123.45])
  })

  it('rejects invalid installment counts', () => {
    expect(() => splitInstallments(100, 0)).toThrow()
    expect(() => splitInstallments(100, -1)).toThrow()
    expect(() => splitInstallments(100, 1.5)).toThrow()
  })
})

describe('computeBuyout', () => {
  it('computes fixed amount plus 25% of job net cash', () => {
    const r = computeBuyout({
      fixedAmount: 10000,
      sharePct: 0.25,
      jobs: [
        { id: 'a', netCash: 8000 },
        { id: 'b', netCash: 4000, label: 'Job B' },
      ],
      installments: 4,
    })
    expect(r.jobShares).toEqual([
      { id: 'a', label: undefined, netCash: 8000, share: 2000 },
      { id: 'b', label: 'Job B', netCash: 4000, share: 1000 },
    ])
    expect(r.variableTotal).toBe(3000)
    expect(r.total).toBe(13000)
    expect(r.provisional).toBe(false)
    expect(r.pendingJobs).toEqual([])
    expect(r.installments).toEqual([3250, 3250, 3250, 3250])
  })

  it('losses reduce the total by default', () => {
    const r = computeBuyout({
      fixedAmount: 0,
      sharePct: 0.25,
      jobs: [{ id: 'a', netCash: 10000 }, { id: 'b', netCash: -2000 }],
      installments: 1,
    })
    expect(r.jobShares[1].share).toBe(-500)
    expect(r.variableTotal).toBe(2000)
    expect(r.total).toBe(2000)
  })

  it('losses do not reduce the total when lossesReduceTotal=false', () => {
    const r = computeBuyout({
      fixedAmount: 1000,
      sharePct: 0.25,
      jobs: [{ id: 'a', netCash: 10000 }, { id: 'b', netCash: -2000 }],
      installments: 1,
      lossesReduceTotal: false,
    })
    expect(r.jobShares[1].share).toBe(0)
    expect(r.jobShares[1].netCash).toBe(-2000)
    expect(r.variableTotal).toBe(2500)
    expect(r.total).toBe(3500)
  })

  it('is provisional when a job netCash is null, and excludes it from the total', () => {
    const r = computeBuyout({
      fixedAmount: 500,
      sharePct: 0.25,
      jobs: [{ id: 'a', netCash: 1000 }, { id: 'p', netCash: null }],
      installments: 2,
    })
    expect(r.provisional).toBe(true)
    expect(r.pendingJobs).toEqual(['p'])
    expect(r.jobShares[1]).toEqual({ id: 'p', label: undefined, netCash: null, share: null })
    expect(r.total).toBe(750)
  })

  it('splits installments that sum exactly to the total', () => {
    const r = computeBuyout({ fixedAmount: 1000.01, sharePct: 0.25, jobs: [], installments: 2 })
    expect(r.total).toBe(1000.01)
    expect(r.installments).toEqual([500.01, 500])
  })

  it('rounds each job share to the cent', () => {
    const r = computeBuyout({ fixedAmount: 0, sharePct: 0.25, jobs: [{ id: 'a', netCash: 100.01 }], installments: 1 })
    expect(r.jobShares[0].share).toBe(25)
  })

  it('works with no jobs (fixed only)', () => {
    const r = computeBuyout({ fixedAmount: 5000, sharePct: 0.25, jobs: [], installments: 5 })
    expect(r.total).toBe(5000)
    expect(r.installments).toEqual([1000, 1000, 1000, 1000, 1000])
    expect(r.provisional).toBe(false)
  })

  it('throws for invalid installment count', () => {
    expect(() => computeBuyout({ fixedAmount: 1, sharePct: 0.25, jobs: [], installments: 0 })).toThrow()
  })
})
