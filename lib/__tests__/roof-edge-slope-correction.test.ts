import {
  hipValleySlopeFactor,
  rakeSlopeFactor,
  slopeCorrectEdgeTotals,
  slopedLengthForLinearFeature,
  tanSqFromMultiplier,
} from '@/lib/roof-edge-slope-correction'
import type { EdgeClassificationResult } from '@/lib/roof-measure-edge-classification'
import { pitchMultiplierFromRise } from '@/lib/roof-measure-geometry'
import { calculateRoofWaste } from '@/lib/roof-waste-model'

const MULT_6_12 = pitchMultiplierFromRise(6) // 1.11803
const MULT_8_12 = pitchMultiplierFromRise(8) // 1.20185

describe('slope factors', () => {
  it('tan² from multiplier recovers (rise/12)²', () => {
    expect(tanSqFromMultiplier(MULT_6_12)).toBeCloseTo(0.25, 6)
    expect(tanSqFromMultiplier(MULT_8_12)).toBeCloseTo((8 / 12) ** 2, 6)
    expect(tanSqFromMultiplier(1)).toBe(0)
    expect(tanSqFromMultiplier(null)).toBe(0)
    expect(tanSqFromMultiplier(0.5)).toBe(0)
  })

  it('hip/valley factor matches standard roofing tables (equal pitch, 90° corner)', () => {
    // 6/12 → √(1 + 0.25/2) = 1.0607; 8/12 → √(1 + 0.4444/2) = 1.1055
    expect(hipValleySlopeFactor(MULT_6_12, MULT_6_12)).toBeCloseTo(1.0607, 3)
    expect(hipValleySlopeFactor(MULT_8_12, MULT_8_12)).toBeCloseTo(1.1055, 3)
    // Flat faces → no correction
    expect(hipValleySlopeFactor(1, 1)).toBe(1)
    // One face unknown → only the known face contributes
    expect(hipValleySlopeFactor(MULT_6_12, null)).toBeCloseTo(Math.sqrt(1 + 0.25 / 4), 6)
  })

  it('rake factor is the pitch multiplier', () => {
    expect(rakeSlopeFactor(MULT_8_12)).toBeCloseTo(MULT_8_12, 6)
    expect(rakeSlopeFactor(1)).toBe(1)
    expect(rakeSlopeFactor(undefined)).toBe(1)
  })
})

describe('slopeCorrectEdgeTotals', () => {
  const baseResult = (over: Partial<EdgeClassificationResult>): EdgeClassificationResult => ({
    ridges_lf: 0,
    hips_lf: 0,
    valleys_lf: 0,
    eaves_lf: 0,
    rakes_lf: 0,
    unclassified_shared_lf: 0,
    classifiedEdges: [],
    ...over,
  })

  it('corrects rakes by facet multiplier and hips/valleys by hip-valley factor; eaves/ridges untouched', () => {
    const result = baseResult({
      ridges_lf: 40,
      hips_lf: 30,
      valleys_lf: 20,
      eaves_lf: 60,
      rakes_lf: 50,
      classifiedEdges: [
        { type: 'ridge', lengthFt: 40, facetIdA: 'a', facetIdB: 'b' },
        { type: 'hip', lengthFt: 30, facetIdA: 'a', facetIdB: 'b' },
        { type: 'valley', lengthFt: 20, facetIdA: 'a', facetIdB: 'b' },
        { type: 'eave', lengthFt: 60, facetIdA: 'a', facetIdB: null },
        { type: 'rake', lengthFt: 50, facetIdA: 'b', facetIdB: null },
      ],
    })
    const mults = new Map([
      ['a', MULT_8_12],
      ['b', MULT_8_12],
    ])
    const corrected = slopeCorrectEdgeTotals(result, mults)
    expect(corrected.ridges_lf).toBe(40)
    expect(corrected.eaves_lf).toBe(60)
    expect(corrected.rakes_lf).toBe(Math.round(50 * MULT_8_12)) // 60
    expect(corrected.valleys_lf).toBe(Math.round(20 * 1.1055)) // 22
    expect(corrected.hips_lf).toBe(Math.round(30 * 1.1055)) // 33
  })

  it('applies per-type ratios to aggregates that were overridden by the 2.5D plane path', () => {
    const result = baseResult({
      // Aggregate differs from the classified-edge sum (plane-intersection override)
      valleys_lf: 40,
      classifiedEdges: [{ type: 'valley', lengthFt: 20, facetIdA: 'a', facetIdB: 'b' }],
    })
    const mults = new Map([
      ['a', MULT_6_12],
      ['b', MULT_6_12],
    ])
    const corrected = slopeCorrectEdgeTotals(result, mults)
    expect(corrected.valleys_lf).toBe(Math.round(40 * 1.0607)) // 42
  })

  it('unset-pitch facets (multiplier 1) produce no correction', () => {
    const result = baseResult({
      rakes_lf: 50,
      classifiedEdges: [{ type: 'rake', lengthFt: 50, facetIdA: 'a', facetIdB: null }],
    })
    const corrected = slopeCorrectEdgeTotals(result, new Map([['a', 1]]))
    expect(corrected.rakes_lf).toBe(50)
  })
})

describe('slopedLengthForLinearFeature', () => {
  // ~27m × ~27m facet at lat 35
  const LAT = 35
  const LNG = -80.8
  const D_LAT = 0.00024
  const D_LNG = 0.0003
  const facetA = {
    points: [
      { lat: LAT, lng: LNG },
      { lat: LAT + D_LAT, lng: LNG },
      { lat: LAT + D_LAT, lng: LNG + D_LNG },
      { lat: LAT, lng: LNG + D_LNG },
    ],
    pitch_multiplier: MULT_8_12,
  }
  // Adjacent facet sharing facetA's east edge
  const facetB = {
    points: [
      { lat: LAT, lng: LNG + D_LNG },
      { lat: LAT + D_LAT, lng: LNG + D_LNG },
      { lat: LAT + D_LAT, lng: LNG + 2 * D_LNG },
      { lat: LAT, lng: LNG + 2 * D_LNG },
    ],
    pitch_multiplier: MULT_8_12,
  }

  it('step flashing inside a facet climbs at the facet multiplier', () => {
    const line = [
      { lat: LAT + D_LAT / 2, lng: LNG + D_LNG * 0.25 },
      { lat: LAT + D_LAT / 2, lng: LNG + D_LNG * 0.75 },
    ]
    const sloped = slopedLengthForLinearFeature({
      type: 'step_flashing',
      points: line,
      planLengthFt: 50,
      facets: [facetA, facetB],
    })
    expect(sloped).toBe(Math.round(50 * MULT_8_12)) // 60
  })

  it('uses the smallest containing facet when roof polygons overlap', () => {
    const dormer = {
      points: [
        { lat: LAT + D_LAT * 0.3, lng: LNG + D_LNG * 0.3 },
        { lat: LAT + D_LAT * 0.7, lng: LNG + D_LNG * 0.3 },
        { lat: LAT + D_LAT * 0.7, lng: LNG + D_LNG * 0.7 },
        { lat: LAT + D_LAT * 0.3, lng: LNG + D_LNG * 0.7 },
      ],
      pitch_multiplier: MULT_6_12,
    }
    const line = [
      { lat: LAT + D_LAT * 0.4, lng: LNG + D_LNG * 0.4 },
      { lat: LAT + D_LAT * 0.6, lng: LNG + D_LNG * 0.6 },
    ]
    const sloped = slopedLengthForLinearFeature({
      type: 'step_flashing',
      points: line,
      planLengthFt: 50,
      facets: [facetA, dormer],
    })
    expect(sloped).toBe(Math.round(50 * MULT_6_12))
  })

  it('valley on the boundary between two facets uses the hip/valley factor', () => {
    const sharedLng = LNG + D_LNG
    const line = [
      { lat: LAT + D_LAT * 0.2, lng: sharedLng },
      { lat: LAT + D_LAT * 0.8, lng: sharedLng },
    ]
    const sloped = slopedLengthForLinearFeature({
      type: 'valley',
      points: line,
      planLengthFt: 50,
      facets: [facetA, facetB],
    })
    expect(sloped).toBe(Math.round(50 * 1.1055)) // 55
  })

  it('ridge and wall flashing are horizontal — plan length returned unchanged', () => {
    const line = [
      { lat: LAT + D_LAT / 2, lng: LNG + D_LNG * 0.25 },
      { lat: LAT + D_LAT / 2, lng: LNG + D_LNG * 0.75 },
    ]
    for (const type of ['ridge', 'wall_flashing'] as const) {
      expect(
        slopedLengthForLinearFeature({ type, points: line, planLengthFt: 50, facets: [facetA] })
      ).toBe(50)
    }
  })

  it('line outside every facet falls back to the roof-average multiplier', () => {
    const farLine = [
      { lat: LAT + 0.01, lng: LNG },
      { lat: LAT + 0.01, lng: LNG + D_LNG },
    ]
    const sloped = slopedLengthForLinearFeature({
      type: 'step_flashing',
      points: farLine,
      planLengthFt: 50,
      facets: [facetA],
      fallbackMultiplier: MULT_8_12,
    })
    expect(sloped).toBe(Math.round(50 * MULT_8_12))
    // No fallback → unchanged
    expect(
      slopedLengthForLinearFeature({
        type: 'step_flashing',
        points: farLine,
        planLengthFt: 50,
        facets: [facetA],
      })
    ).toBe(50)
  })
})

describe('waste model with slope-corrected LF', () => {
  it('lfIsSloped skips the plan→sloped course multiplier (no double count)', () => {
    const base = {
      baseSquares: 30,
      facetCount: 6,
      valleys_lf: 60,
      hips_lf: 0,
      ridges_lf: 50,
      avgPitchMultiplier: MULT_8_12,
      avgPitchDegrees: 33.7,
    }
    const plan = calculateRoofWaste(base)
    const sloped = calculateRoofWaste({ ...base, lfIsSloped: true })
    expect(sloped.breakdown.valleySq).toBeLessThan(plan.breakdown.valleySq)
    expect(sloped.breakdown.valleySq).toBeCloseTo(plan.breakdown.valleySq / MULT_8_12, 1)
    // Ridges are horizontal (never slope-corrected) — ridge trim must be identical either way.
    expect(sloped.breakdown.ridgeTrimSq).toBeCloseTo(plan.breakdown.ridgeTrimSq, 5)
  })
})
