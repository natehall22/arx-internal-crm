/**
 * Hypothetical / teaching: per-face shingle layout + stagger waste.
 * Not wired to production UI. Compare roof-level totals to calculateRoofWaste.
 */
import {
  ARCHITECTURAL_EXPOSURE_IN,
  EXPOSURE_FT,
  SHINGLES_PER_SQUARE,
  SHINGLE_LENGTH_IN,
} from '@/lib/roof-shingle-constants'
import { pitchDegreesFromRise, pitchMultiplierFromRise } from '@/lib/roof-measure-geometry'

export type StaggerPolicy = 'NONE' | 'S1_HALF_TAB' | 'S2_SIX_IN_STEP'

export type FaceShingleInput = {
  /** Sloped face area (roofing square = 100 sq ft). */
  faceAreaSqft: number
  /** Length along eave; courses run parallel to this. */
  eaveRunFt: number
  pitchRise: number
  /** Full shingle length along eave (default 3′ = 36″). */
  shingleLengthFt?: number
  /** Exposure per course in feet; default production 5.625″. */
  exposureFt?: number
  /** Optional larger exposure for teaching-only runs (label in output). */
  teachingExposureFt?: number
  stagger?: StaggerPolicy
}

export type FaceShingleResult = {
  eaveRunFt: number
  rakeSpanPlanFt: number
  pitchRise: number
  pitchMultiplier: number
  pitchDegrees: number
  exposureFt: number
  exposureLabel: 'production' | 'teaching'
  shingleLengthFt: number
  nCourses: number
  row1Shingles: number
  shinglesPerCourse: number[]
  totalShingles: number
  naiveBaselineShingles: number
  staggerExtraShingles: number
  staggerWastePercent: number
  faceSquares: number
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Plan rake span from sloped area: area = eave × rakePlan × pitchMult */
export function rakeSpanPlanFromSlopedArea(
  faceAreaSqft: number,
  eaveRunFt: number,
  pitchRise: number
): number {
  if (faceAreaSqft <= 0 || eaveRunFt <= 0) return 0
  const mult = pitchMultiplierFromRise(pitchRise)
  return faceAreaSqft / (eaveRunFt * mult)
}

export function shinglesAlongRun(runFt: number, shingleLengthFt: number): number {
  if (runFt <= 0 || shingleLengthFt <= 0) return 0
  return Math.ceil(runFt / shingleLengthFt)
}

/** Stagger offset at the starting edge of course i (feet). */
export function staggerOffsetFt(courseIndex: number, policy: StaggerPolicy, shingleLengthFt: number): number {
  switch (policy) {
    case 'NONE':
      return 0
    case 'S1_HALF_TAB':
      return courseIndex % 2 === 1 ? shingleLengthFt / 2 : 0
    case 'S2_SIX_IN_STEP':
      return ((courseIndex * 0.5) % shingleLengthFt)
    default:
      return 0
  }
}

/**
 * Shingles for one course: same eave coverage with optional start offset
 * (extra partial at the high-numbered end — standard estimating approach).
 */
export function shinglesForCourse(
  eaveRunFt: number,
  courseIndex: number,
  shingleLengthFt: number,
  stagger: StaggerPolicy
): number {
  const offset = staggerOffsetFt(courseIndex, stagger, shingleLengthFt)
  return shinglesAlongRun(eaveRunFt + offset, shingleLengthFt)
}

export function computeFaceShingles(input: FaceShingleInput): FaceShingleResult {
  const shingleLengthFt = input.shingleLengthFt ?? SHINGLE_LENGTH_IN / 12
  const teaching = input.teachingExposureFt
  const exposureFt = teaching != null && teaching > 0 ? teaching : (input.exposureFt ?? EXPOSURE_FT)
  const exposureLabel: 'production' | 'teaching' =
    teaching != null && teaching > 0 ? 'teaching' : 'production'
  const stagger = input.stagger ?? 'S1_HALF_TAB'
  const pitchRise = input.pitchRise
  const pitchMultiplier = pitchMultiplierFromRise(pitchRise)
  const pitchDegrees = pitchDegreesFromRise(pitchRise)
  const eaveRunFt = input.eaveRunFt
  const rakeSpanPlanFt = rakeSpanPlanFromSlopedArea(input.faceAreaSqft, eaveRunFt, pitchRise)
  /** Sloped distance eave→ridge: area / eave (pitch cancels in plan×mult). */
  const rakeSlopeFt = input.faceAreaSqft / eaveRunFt
  const nCourses = Math.ceil(rakeSlopeFt / exposureFt)

  const shinglesPerCourse: number[] = []
  for (let i = 0; i < nCourses; i++) {
    shinglesPerCourse.push(shinglesForCourse(eaveRunFt, i, shingleLengthFt, stagger))
  }

  const row1Shingles = shinglesForCourse(eaveRunFt, 0, shingleLengthFt, 'NONE')
  const naivePerCourse = shinglesAlongRun(eaveRunFt, shingleLengthFt)
  const naiveBaselineShingles = nCourses * naivePerCourse
  const totalShingles = shinglesPerCourse.reduce((a, b) => a + b, 0)
  const staggerExtraShingles = Math.max(0, totalShingles - naiveBaselineShingles)
  const staggerWastePercent =
    naiveBaselineShingles > 0 ? round3((staggerExtraShingles / naiveBaselineShingles) * 100) : 0

  return {
    eaveRunFt,
    rakeSpanPlanFt: round3(rakeSpanPlanFt),
    pitchRise,
    pitchMultiplier: round3(pitchMultiplier),
    pitchDegrees: round3(pitchDegrees),
    exposureFt,
    exposureLabel,
    shingleLengthFt,
    nCourses,
    row1Shingles,
    shinglesPerCourse,
    totalShingles,
    naiveBaselineShingles,
    staggerExtraShingles,
    staggerWastePercent,
    faceSquares: round3(input.faceAreaSqft / 100),
  }
}

/** Canonical teaching anchor: 1 square sloped, 30′ eave, row 1 = 10 @ 3′ shingles. */
export const ANCHOR_ONE_SQUARE = {
  faceAreaSqft: 100,
  eaveRunFt: 30,
  pitchRise: 4,
  shingleLengthFt: 3,
} as const

export function productionExposureInches(): number {
  return ARCHITECTURAL_EXPOSURE_IN
}

export function shinglesPerSquareProduction(): number {
  return SHINGLES_PER_SQUARE
}
