import { buildMaterialsExtras } from '@/lib/materials-order-extras'

describe('buildMaterialsExtras', () => {
  it('returns null when there is nothing to summarize', () => {
    expect(buildMaterialsExtras(null)).toBeNull()
    expect(buildMaterialsExtras({ raw_data: { facets: [] } })).toBeNull()
  })

  it('detects low-slope facets from pitch_rise', () => {
    const out = buildMaterialsExtras({
      raw_data: {
        facets: [
          { pitch_rise: 1, area_sqft: 200 },
          { pitch_rise: 4, area_sqft: 500 },
          { pitch_rise: 0.5, area_sqft: 100 },
        ],
      },
    })
    expect(out).toEqual({
      ridge_segment_count: null,
      low_slope_area_sqft: 300,
      low_slope_facet_count: 2,
      penetration_count: null,
    })
  })

  it('parses low-slope pitch from "1/12" strings', () => {
    const out = buildMaterialsExtras({
      raw_data: {
        facets: [{ pitch: '1/12', area_sqft: 180 }],
      },
    })
    expect(out?.low_slope_area_sqft).toBe(180)
    expect(out?.low_slope_facet_count).toBe(1)
  })

  it('counts ridge runs from linear_features', () => {
    const out = buildMaterialsExtras({
      raw_data: {
        linear_features: [{ type: 'ridge' }, { type: 'valley' }, { type: 'ridge' }],
      },
    })
    expect(out?.ridge_segment_count).toBe(2)
  })

  it('prefers ridge_run_count from raw_data over linear_features', () => {
    const out = buildMaterialsExtras({
      raw_data: {
        ridge_run_count: 3,
        linear_features: [{ type: 'ridge' }],
      },
    })
    expect(out?.ridge_segment_count).toBe(3)
  })

  it('floors positive penetration_count from the measurement row', () => {
    const out = buildMaterialsExtras({ penetration_count: 2.9 })
    expect(out?.penetration_count).toBe(2)
  })

  it('reads penetration_count from raw_data when the column is empty', () => {
    const out = buildMaterialsExtras({ raw_data: { penetration_count: 4 } })
    expect(out?.penetration_count).toBe(4)
  })
})
