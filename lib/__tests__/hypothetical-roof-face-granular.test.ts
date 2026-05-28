import {
  ANCHOR_ONE_SQUARE,
  computeFaceShingles,
  rakeSpanPlanFromSlopedArea,
  shinglesAlongRun,
  shinglesForCourse,
} from '@/lib/hypothetical-roof-face-granular'
import { calculateRoofWaste } from '@/lib/roof-waste-model'
import { roofWasteAndOrder } from '@/lib/roof-material-order'
import { pitchMultiplierFromRise } from '@/lib/roof-measure-geometry'
import {
  EXPOSURE_FT,
  SHINGLES_PER_SQUARE,
} from '@/lib/roof-shingle-constants'

describe('hypothetical-roof-face-granular (teaching anchor)', () => {
  it('geometry: 1 square sloped + 30′ eave → rake span ~3.16′ plan @ 4/12 (not 10′×10′ plan)', () => {
    const rake = rakeSpanPlanFromSlopedArea(100, 30, 4)
    expect(rake).toBeCloseTo(100 / (30 * pitchMultiplierFromRise(4)), 2)
    expect(rake).toBeLessThan(4)
    expect(30 * rake * pitchMultiplierFromRise(4)).toBeCloseTo(100, 0)
  })

  it('row 1 = 10 shingles (30′ ÷ 3′)', () => {
    expect(shinglesAlongRun(30, 3)).toBe(10)
    const face = computeFaceShingles({
      ...ANCHOR_ONE_SQUARE,
      stagger: 'NONE',
    })
    expect(face.row1Shingles).toBe(10)
  })

  it('S1 half-tab increases total vs NONE on anchor face', () => {
    const none = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, stagger: 'NONE' })
    const s1 = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, stagger: 'S1_HALF_TAB' })
    expect(s1.totalShingles).toBeGreaterThan(none.totalShingles)
    expect(s1.staggerExtraShingles).toBeGreaterThan(0)
    expect(s1.staggerWastePercent).toBeGreaterThan(0)
  })

  it('S2 six-inch step increases total vs NONE', () => {
    const none = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, stagger: 'NONE' })
    const s2 = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, stagger: 'S2_SIX_IN_STEP' })
    expect(s2.totalShingles).toBeGreaterThan(none.totalShingles)
  })

  it('production exposure (5.625″) is default; teaching exposure is labeled', () => {
    const prod = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, stagger: 'NONE' })
    expect(prod.exposureLabel).toBe('production')
    expect(prod.exposureFt).toBeCloseTo(EXPOSURE_FT, 4)

    const teach = computeFaceShingles({
      ...ANCHOR_ONE_SQUARE,
      stagger: 'NONE',
      teachingExposureFt: 1,
    })
    expect(teach.exposureLabel).toBe('teaching')
    expect(teach.nCourses).toBeLessThan(prod.nCourses)
  })

  it('scales ~2× shingles when sloped area doubles (60′ eave, 200 sq ft, 4/12)', () => {
    const small = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, stagger: 'NONE' })
    const medium = computeFaceShingles({
      faceAreaSqft: 200,
      eaveRunFt: 60,
      pitchRise: 4,
      shingleLengthFt: 3,
      stagger: 'NONE',
    })
    expect(medium.naiveBaselineShingles).toBeCloseTo(small.naiveBaselineShingles * 2, 0)
  })

  it('fixed 1 sq + 30′ eave: pitch changes plan rake, not slope length (nCourses unchanged)', () => {
    const f4 = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, pitchRise: 4, stagger: 'NONE' })
    const f8 = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, pitchRise: 8, stagger: 'NONE' })
    expect(f8.row1Shingles).toBe(10)
    expect(f8.nCourses).toBe(f4.nCourses)
    expect(f8.rakeSpanPlanFt).toBeLessThan(f4.rakeSpanPlanFt)

    const w4 = calculateRoofWaste({
      baseSquares: 28.13,
      facetCount: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avgPitchMultiplier: pitchMultiplierFromRise(4),
      avgPitchDegrees: 18.43,
    })
    const w8 = calculateRoofWaste({
      baseSquares: 28.13,
      facetCount: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avgPitchMultiplier: pitchMultiplierFromRise(8),
      avgPitchDegrees: 33.69,
    })
    expect(w8.wastePercent).toBeGreaterThan(w4.wastePercent)
  })

  it('toy face shingle count vs 63/square order unit (teaching, not production order)', () => {
    const face = computeFaceShingles({ ...ANCHOR_ONE_SQUARE, stagger: 'S1_HALF_TAB' })
    const squaresFromShingles = face.totalShingles / SHINGLES_PER_SQUARE
    expect(face.faceSquares).toBe(1)
    expect(squaresFromShingles).toBeGreaterThan(1)
  })

  it('Greenway roofWasteAndOrder caps unchanged when pitch changes', () => {
    const o4 = roofWasteAndOrder({
      total_squares: 28.13,
      facet_count: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avg_pitch_multiplier: pitchMultiplierFromRise(4),
    })
    const o8 = roofWasteAndOrder({
      total_squares: 28.13,
      facet_count: 7,
      valleys_lf: 68,
      hips_lf: 109,
      ridges_lf: 112,
      avg_pitch_multiplier: pitchMultiplierFromRise(8),
    })
    expect(o4.caps!.combinedCapSq).toBe(o8.caps!.combinedCapSq)
    expect(o8.field.recommendedOrderSquares).toBeGreaterThanOrEqual(o4.field.recommendedOrderSquares)
  })
})

describe('per-course stagger detail (anchor)', () => {
  it('row 2+ under S1: even courses need more shingles than row 1', () => {
    expect(shinglesForCourse(30, 0, 3, 'NONE')).toBe(10)
    expect(shinglesForCourse(30, 1, 3, 'S1_HALF_TAB')).toBe(11)
    expect(shinglesForCourse(30, 2, 3, 'S1_HALF_TAB')).toBe(10)
    expect(shinglesForCourse(30, 3, 3, 'S1_HALF_TAB')).toBe(11)
  })
})
