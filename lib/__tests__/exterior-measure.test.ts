import { calculateElevationMeasure, calculateExteriorMeasureTotals } from '@/lib/exterior-measure'

describe('exterior measure calculations', () => {
  it('calculates elevation siding, opening deductions, waste, and accessories', () => {
    const result = calculateElevationMeasure({
      wall_width_ft: 40,
      wall_height_ft: 10,
      gable_width_ft: 20,
      gable_height_ft: 6,
      waste_percent: 10,
      soffit_depth_ft: 2,
      soffit_length_ft: 40,
      fascia_lf: 44,
      gutter_lf: 40,
      starter_strip_lf: 40,
      j_channel_lf: 120,
      inside_corners: 1,
      outside_corners: 2,
      openings: [
        { width_ft: 3, height_ft: 5, quantity: 2 },
        { width_ft: 3, height_ft: 7, quantity: 1 },
      ],
    })

    expect(result.gross_wall_sqft).toBe(400)
    expect(result.gable_sqft).toBe(60)
    expect(result.opening_deductions_sqft).toBe(51)
    expect(result.net_siding_sqft).toBe(409)
    expect(result.waste_sqft).toBe(40.9)
    expect(result.siding_squares).toBe(4.5)
    expect(result.soffit_sqft).toBe(80)
    expect(result.fascia_lf).toBe(44)
    expect(result.gutter_lf).toBe(40)
    expect(result.j_channel_lf).toBe(120)
    expect(result.inside_corners).toBe(1)
    expect(result.outside_corners).toBe(2)
  })

  it('sums totals and derives siding squares from final sqft with waste', () => {
    const totals = calculateExteriorMeasureTotals([
      { wall_width_ft: 20, wall_height_ft: 10, waste_percent: 10 },
      { wall_width_ft: 10, wall_height_ft: 10, waste_percent: 20 },
    ])

    expect(totals.net_siding_sqft).toBe(300)
    expect(totals.siding_sqft_with_waste).toBe(340)
    expect(totals.siding_squares).toBe(3.4)
  })
})
