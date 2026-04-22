import { computeRoofSquaresEquation, formatSqPart, roundRoofSq } from '@/lib/roof-squares-equation'

describe('roof-squares-equation', () => {
  it('uses total − measure for waste when both known', () => {
    const r = computeRoofSquaresEquation({
      totalSquares: 5.8,
      measuredSquares: 5.27,
      wastePercent: 10,
    })
    expect(r).toEqual({ measure: 5.27, waste: roundRoofSq(5.8 - 5.27), total: 5.8 })
  })

  it('derives measure and waste from total + waste %', () => {
    const r = computeRoofSquaresEquation({
      totalSquares: 11,
      measuredSquares: null,
      wastePercent: 10,
    })
    expect(r?.total).toBe(11)
    expect(r?.measure).toBe(10)
    expect(r?.waste).toBe(1)
  })

  it('derives total from measure + waste %', () => {
    const r = computeRoofSquaresEquation({
      totalSquares: null,
      measuredSquares: 10,
      wastePercent: 10,
    })
    expect(r).toEqual({ measure: 10, waste: 1, total: 11 })
  })

  it('returns total only when no measure or pct', () => {
    const r = computeRoofSquaresEquation({
      totalSquares: 12.5,
      measuredSquares: null,
      wastePercent: null,
    })
    expect(r).toEqual({ measure: null, waste: null, total: 12.5 })
  })

  it('formatSqPart handles null', () => {
    expect(formatSqPart(null)).toBe('—')
    expect(formatSqPart(3)).toBe('3.0')
  })
})
