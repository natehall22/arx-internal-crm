import { DEFAULT_CAP_LF_PER_SQUARE } from '@/lib/roof-shingle-constants'

/** @deprecated Use DEFAULT_CAP_LF_PER_SQUARE from roof-shingle-constants */
export const DEFAULT_HIP_RIDGE_CAP_LF_PER_SQUARE = DEFAULT_CAP_LF_PER_SQUARE

function roundCapSq(n: number): number {
  return Math.round(n * 100) / 100
}

function positiveLf(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(Number(value))) return 0
  const n = Number(value)
  return n > 0 ? n : 0
}

export type HipRidgeCapSummary = {
  /** Ridge LF + hip LF from measure. */
  combinedLf: number
  /** Estimated cap squares for ordering (not field roof area). */
  capSq: number
  lfPerSquare: number
}

/**
 * Returns null when there is no hip or ridge LF to summarize.
 */
export function capOrderSquaresFromLf(
  lf: number | null | undefined,
  lfPerSquare: number = DEFAULT_HIP_RIDGE_CAP_LF_PER_SQUARE
): number {
  const n = positiveLf(lf)
  if (n <= 0 || !(lfPerSquare > 0)) return 0
  return roundCapSq(n / lfPerSquare)
}

export type RidgeHipCapOrderSummary = {
  ridgeCapSq: number
  hipCapSq: number
  combinedCapSq: number
  ridges_lf: number
  hips_lf: number
  lfPerSquare: number
}

/** Cap material order in squares (100 LF/sq rule), not field roof squares. */
export function ridgeHipCapOrderSummary(input: {
  ridges_lf: number | null | undefined
  hips_lf: number | null | undefined
  lfPerSquare?: number
}): RidgeHipCapOrderSummary | null {
  const lfPerSq = input.lfPerSquare ?? DEFAULT_HIP_RIDGE_CAP_LF_PER_SQUARE
  const ridges_lf = positiveLf(input.ridges_lf)
  const hips_lf = positiveLf(input.hips_lf)
  if (ridges_lf <= 0 && hips_lf <= 0) return null

  const ridgeCapSq = capOrderSquaresFromLf(ridges_lf, lfPerSq)
  const hipCapSq = capOrderSquaresFromLf(hips_lf, lfPerSq)
  const combinedCapSq = roundCapSq(ridgeCapSq + hipCapSq)

  return {
    ridgeCapSq,
    hipCapSq,
    combinedCapSq,
    ridges_lf,
    hips_lf,
    lfPerSquare: lfPerSq,
  }
}

export function hipRidgeCapFromLinearFt(input: {
  ridges_lf: number | null | undefined
  hips_lf: number | null | undefined
  lfPerSquare?: number
}): HipRidgeCapSummary | null {
  const lfPerSq = input.lfPerSquare ?? DEFAULT_HIP_RIDGE_CAP_LF_PER_SQUARE
  if (!(lfPerSq > 0)) return null

  const combinedLf = roundCapSq(positiveLf(input.ridges_lf) + positiveLf(input.hips_lf))
  if (combinedLf <= 0) return null

  const capSq = roundCapSq(combinedLf / lfPerSq)
  if (!(capSq > 0)) return null

  return { combinedLf, capSq, lfPerSquare: lfPerSq }
}
