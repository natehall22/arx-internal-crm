import { buildRoofMeasurementLinear, ridgeHipValleyUnverified } from '@/lib/job-sold-scope'

describe('ridgeHipValleyUnverified', () => {
  it('uses the saved pending count on new measurements', () => {
    expect(ridgeHipValleyUnverified({ downslope_review_pending: 4 })).toBe(true)
    expect(ridgeHipValleyUnverified({ downslope_review_pending: 0 })).toBe(false)
  })

  it('a saved count of 0 wins over a stale note', () => {
    expect(
      ridgeHipValleyUnverified({
        downslope_review_pending: 0,
        validation_notes: ['4 sections may need manual downslope for accurate ridge/hip/valley LF.'],
      })
    ).toBe(false)
  })

  it('falls back to the validation note on older measurements (26-0048)', () => {
    expect(
      ridgeHipValleyUnverified({
        validation_notes: [
          '4 sections may need manual downslope for accurate ridge/hip/valley LF. Point the arrow toward the eave — not the Solar facing label.',
        ],
      })
    ).toBe(true)
    expect(ridgeHipValleyUnverified({ validation_notes: ['Outlines are approximate'] })).toBe(false)
  })

  it('is false with no raw data or junk values', () => {
    expect(ridgeHipValleyUnverified(null)).toBe(false)
    expect(ridgeHipValleyUnverified({ validation_notes: 'not an array' })).toBe(false)
    expect(ridgeHipValleyUnverified({ downslope_review_pending: null })).toBe(false)
  })

  it('rides on the linear block every order sheet reads', () => {
    const linear = buildRoofMeasurementLinear({
      ridges_lf: 22,
      raw_data: { downslope_review_pending: 4 },
    })
    expect(linear?.ridge_hip_valley_unverified).toBe(true)
  })
})
