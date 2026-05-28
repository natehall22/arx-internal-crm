import { calculateRoofWaste, coursesAlongLinearLf } from '@/lib/roof-waste-model'
import { ridgeHipCapOrderSummary } from '@/lib/hip-ridge-cap-squares'
import { roofWasteAndOrder } from '@/lib/roof-material-order'
import { pitchDegreesFromRise, pitchMultiplierFromRise } from '@/lib/roof-measure-geometry'

describe('roof-waste-model (granular)', () => {
  it('Greenway re-measure: ~17% waste with valley as largest cut component', () => {
    const w = calculateRoofWaste({
      baseSquares: 28.13,
      facetCount: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avgPitchMultiplier: 1.054,
      avgPitchDegrees: 18.43,
    })
    expect(w.wastePercent).toBeGreaterThanOrEqual(15)
    expect(w.wastePercent).toBeLessThanOrEqual(20)
    expect(w.breakdown.valleySq).toBeGreaterThan(w.breakdown.ridgeTrimSq)
    expect(w.breakdown.valleySq).toBeGreaterThan(0.5)
    const breakdownSum =
      w.breakdown.baseAreaSq +
      w.breakdown.valleySq +
      w.breakdown.hipFieldSq +
      w.breakdown.ridgeTrimSq +
      w.breakdown.facetComplexitySq +
      w.breakdown.pitchModifierSq
    expect(breakdownSum).toBeCloseTo(w.wasteSquares, 1)
    if (w.floorApplied) {
      expect(w.wastePercent).toBe(17)
    }
  })

  it('valleys increase waste more than ridge LF alone', () => {
    const noValley = calculateRoofWaste({
      baseSquares: 20,
      facetCount: 4,
      valleys_lf: 0,
      hips_lf: 0,
      ridges_lf: 100,
      avgPitchMultiplier: 1.05,
    })
    const withValley = calculateRoofWaste({
      baseSquares: 20,
      facetCount: 4,
      valleys_lf: 60,
      hips_lf: 0,
      ridges_lf: 100,
      avgPitchMultiplier: 1.05,
    })
    expect(withValley.wastePercent).toBeGreaterThan(noValley.wastePercent)
    expect(withValley.breakdown.valleySq).toBeGreaterThan(0)
  })

  it('simple gable floor: minimum 10% waste', () => {
    const w = calculateRoofWaste({
      baseSquares: 22,
      facetCount: 2,
      valleys_lf: 0,
      hips_lf: 0,
      ridges_lf: 40,
      avgPitchMultiplier: 1.05,
    })
    expect(w.wastePercent).toBeGreaterThanOrEqual(10)
  })

  it('Greenway granular sum below 17% floor before calibration', () => {
    const w = calculateRoofWaste({
      baseSquares: 28.13,
      facetCount: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avgPitchMultiplier: 1.054,
    })
    expect(w.floorApplied).toBe(true)
    expect(w.wastePercent).toBe(17)
    expect(w.wasteSquares).toBeCloseTo(28.13 * 0.17, 1)
  })

  it('ridge/hip cap order in squares (Greenway)', () => {
    const caps = ridgeHipCapOrderSummary({ ridges_lf: 112, hips_lf: 109 })
    expect(caps!.ridgeCapSq).toBe(1.12)
    expect(caps!.hipCapSq).toBe(1.09)
    expect(caps!.combinedCapSq).toBe(2.21)
  })

  it('roofWasteAndOrder integrates field + cap', () => {
    const o = roofWasteAndOrder({
      total_squares: 28.13,
      facet_count: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avg_pitch_multiplier: 1.054,
    })
    expect(o.field.recommendedOrderSquares).toBeGreaterThanOrEqual(32)
    expect(o.caps!.combinedCapSq).toBeCloseTo(2.21, 2)
  })

  it('8/12 pitch increases field waste vs 4/12 at same LF', () => {
    const greenway = {
      baseSquares: 28.13,
      facetCount: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
    }
    const mult4 = pitchMultiplierFromRise(4)
    const mult8 = pitchMultiplierFromRise(8)
    expect(mult4).toBeCloseTo(1.054, 3)
    expect(mult8).toBeCloseTo(1.202, 3)
    expect(pitchDegreesFromRise(4)).toBeCloseTo(18.43, 2)
    expect(pitchDegreesFromRise(8)).toBeCloseTo(33.69, 2)

    const w4 = calculateRoofWaste({
      ...greenway,
      avgPitchMultiplier: mult4,
      avgPitchDegrees: pitchDegreesFromRise(4),
    })
    const w8 = calculateRoofWaste({
      ...greenway,
      avgPitchMultiplier: mult8,
      avgPitchDegrees: pitchDegreesFromRise(8),
    })

    expect(w4.floorApplied).toBe(true)
    expect(w4.wastePercent).toBe(17)
    expect(w8.wastePercent).toBeGreaterThan(w4.wastePercent)
    expect(w8.breakdown.pitchModifierSq).toBeGreaterThan(0)
    expect(w8.breakdown.valleySq).toBeGreaterThan(w4.breakdown.valleySq)
    expect(w8.breakdown.hipFieldSq).toBeGreaterThan(w4.breakdown.hipFieldSq)
    expect(w8.breakdown.ridgeTrimSq).toBeGreaterThan(w4.breakdown.ridgeTrimSq)

    expect(coursesAlongLinearLf(68, mult8)).toBeGreaterThan(coursesAlongLinearLf(68, mult4))

    const o4 = roofWasteAndOrder({
      total_squares: 28.13,
      facet_count: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avg_pitch_multiplier: mult4,
      avg_pitch_degrees: pitchDegreesFromRise(4),
    })
    const o8 = roofWasteAndOrder({
      total_squares: 28.13,
      facet_count: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avg_pitch_multiplier: mult8,
      avg_pitch_degrees: pitchDegreesFromRise(8),
    })
    expect(o8.field.recommendedOrderSquares).toBeGreaterThanOrEqual(o4.field.recommendedOrderSquares)
    expect(o4.caps!.combinedCapSq).toBe(o8.caps!.combinedCapSq)
    expect(o4.caps!.combinedCapSq).toBe(2.21)
  })
})
