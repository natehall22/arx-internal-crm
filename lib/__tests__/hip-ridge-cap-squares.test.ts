import {
  DEFAULT_HIP_RIDGE_CAP_LF_PER_SQUARE,
  hipRidgeCapFromLinearFt,
} from '@/lib/hip-ridge-cap-squares'

describe('hipRidgeCapFromLinearFt', () => {
  it('returns null when no hip or ridge LF', () => {
    expect(hipRidgeCapFromLinearFt({ ridges_lf: null, hips_lf: null })).toBeNull()
    expect(hipRidgeCapFromLinearFt({ ridges_lf: 0, hips_lf: 0 })).toBeNull()
  })

  it('sums ridge and hip and converts at default LF/sq', () => {
    const r = hipRidgeCapFromLinearFt({ ridges_lf: 73, hips_lf: 192 })
    expect(r?.combinedLf).toBe(265)
    expect(r?.capSq).toBe(2.65)
    expect(r?.lfPerSquare).toBe(DEFAULT_HIP_RIDGE_CAP_LF_PER_SQUARE)
  })

  it('respects custom lfPerSquare', () => {
    const r = hipRidgeCapFromLinearFt({ ridges_lf: 100, hips_lf: 0, lfPerSquare: 50 })
    expect(r?.combinedLf).toBe(100)
    expect(r?.capSq).toBe(2)
  })
})
