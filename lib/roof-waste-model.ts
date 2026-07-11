import {
  BASE_AREA_WASTE_RATE,
  EXPOSURE_FT,
  MAX_WASTE_PERCENT,
  MIN_WASTE_PERCENT,
  SHINGLES_PER_SQUARE,
  WASTE_SHINGLES_PER_COURSE_HIP,
  WASTE_SHINGLES_PER_COURSE_RIDGE_TRIM,
  WASTE_SHINGLES_PER_COURSE_VALLEY,
} from '@/lib/roof-shingle-constants'

export type RoofWasteBreakdown = {
  baseAreaSq: number
  valleySq: number
  hipFieldSq: number
  ridgeTrimSq: number
  facetComplexitySq: number
  pitchModifierSq: number
}

export type RoofWasteEstimate = {
  wastePercent: number
  wasteSquares: number
  category: string
  breakdown: RoofWasteBreakdown
  /** True when LF-calibrated floor raised waste above granular sum (breakdown scaled to match). */
  floorApplied?: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function positive(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Sloped courses along a plan-view LF line (valley, hip, ridge). */
export function coursesAlongLinearLf(lf: number, pitchMultiplier: number): number {
  const m = pitchMultiplier > 0 ? pitchMultiplier : 1
  return positive(lf) * m / EXPOSURE_FT
}

function wasteSqFromCourses(courses: number, shinglesPerCourse: number): number {
  if (courses <= 0) return 0
  return round2((courses * shinglesPerCourse) / SHINGLES_PER_SQUARE)
}

/**
 * Granular field-shingle waste from roof face + cut geometry (not cap bundles).
 * Valleys drive the largest per-foot waste; hips and ridge trim add field cuts.
 */
export function calculateRoofWaste(input: {
  baseSquares: number
  facetCount: number
  valleys_lf: number
  hips_lf: number
  ridges_lf: number
  avgPitchMultiplier: number
  avgPitchDegrees?: number
  /** True when the LF inputs are already slope-corrected (true roof-surface lengths) — skip the plan→sloped course multiplier. */
  lfIsSloped?: boolean
}): RoofWasteEstimate {
  const baseSquares = positive(input.baseSquares)
  if (baseSquares <= 0 || input.facetCount <= 0) {
    return {
      wastePercent: 10,
      wasteSquares: 0,
      category: 'simple',
      breakdown: {
        baseAreaSq: 0,
        valleySq: 0,
        hipFieldSq: 0,
        ridgeTrimSq: 0,
        facetComplexitySq: 0,
        pitchModifierSq: 0,
      },
    }
  }

  const pitchMult = input.avgPitchMultiplier > 0 ? input.avgPitchMultiplier : 1
  // Slope-corrected valley/hip LF already includes the climb along the roof surface.
  // Ridges are horizontal either way (plan = true length), so ridge-trim courses
  // keep the pitch multiplier regardless of the flag — behavior unchanged there.
  const courseMult = input.lfIsSloped ? 1 : pitchMult
  const ridgeCourseMult = pitchMult
  const facetCount = Math.max(1, input.facetCount)

  const sizeFactor = Math.min(1.15, Math.max(0.85, Math.sqrt(20 / baseSquares)))
  const baseAreaSq = round2(baseSquares * BASE_AREA_WASTE_RATE * sizeFactor)

  const valleySq = wasteSqFromCourses(
    coursesAlongLinearLf(input.valleys_lf, courseMult),
    WASTE_SHINGLES_PER_COURSE_VALLEY
  )
  const hipFieldSq = wasteSqFromCourses(
    coursesAlongLinearLf(input.hips_lf, courseMult),
    WASTE_SHINGLES_PER_COURSE_HIP
  )
  const ridgeTrimSq = wasteSqFromCourses(
    coursesAlongLinearLf(input.ridges_lf, ridgeCourseMult),
    WASTE_SHINGLES_PER_COURSE_RIDGE_TRIM
  )

  let facetComplexitySq = 0
  if (facetCount > 4) {
    facetComplexitySq += round2(baseSquares * 0.003 * (facetCount - 4))
  }
  const avgFacetSq = (baseSquares * 100) / facetCount
  if (avgFacetSq < 400) {
    facetComplexitySq += round2(baseSquares * 0.01 * ((400 - avgFacetSq) / 400))
  }

  let pitchModifierSq = 0
  const avgDeg = input.avgPitchDegrees ?? 0
  if (avgDeg > 35) pitchModifierSq = round2(baseSquares * 0.02)
  else if (avgDeg > 25) pitchModifierSq = round2(baseSquares * 0.01)

  const breakdown: RoofWasteBreakdown = {
    baseAreaSq,
    valleySq,
    hipFieldSq,
    ridgeTrimSq,
    facetComplexitySq,
    pitchModifierSq,
  }

  const granularSum = round2(
    breakdown.baseAreaSq +
      breakdown.valleySq +
      breakdown.hipFieldSq +
      breakdown.ridgeTrimSq +
      breakdown.facetComplexitySq +
      breakdown.pitchModifierSq
  )
  let wasteSquares = granularSum
  let wastePercent = round2((wasteSquares / baseSquares) * 100)
  let floorApplied = false

  // Align with industry 15–20% for hip + valley roofs (NRCA-style guides, complex layouts)
  if (input.valleys_lf >= 40 && input.hips_lf >= 60 && wastePercent < 17) {
    floorApplied = true
    wastePercent = 17
    wasteSquares = round2(baseSquares * 0.17)
  } else if (input.hips_lf >= 60 && wastePercent < 15) {
    floorApplied = true
    wastePercent = 15
    wasteSquares = round2(baseSquares * 0.15)
  }

  wastePercent = Math.min(MAX_WASTE_PERCENT, Math.max(MIN_WASTE_PERCENT, wastePercent))

  if (floorApplied && granularSum > 0 && wasteSquares > granularSum) {
    const scale = wasteSquares / granularSum
    breakdown.baseAreaSq = round2(breakdown.baseAreaSq * scale)
    breakdown.valleySq = round2(breakdown.valleySq * scale)
    breakdown.hipFieldSq = round2(breakdown.hipFieldSq * scale)
    breakdown.ridgeTrimSq = round2(breakdown.ridgeTrimSq * scale)
    breakdown.facetComplexitySq = round2(breakdown.facetComplexitySq * scale)
    breakdown.pitchModifierSq = round2(breakdown.pitchModifierSq * scale)
  }

  let category = 'Simple'
  if (facetCount > 12) category = 'Very Complex'
  else if (facetCount > 8) category = 'Complex'
  else if (facetCount > 4) category = 'Moderate'

  return {
    wastePercent,
    wasteSquares,
    category: `${category} (${facetCount} sections)`,
    breakdown,
    floorApplied: floorApplied || undefined,
  }
}
