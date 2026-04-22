/**
 * Rough cap-shingle order rule: combined hip + ridge lineal feet ÷ LF per “square” of cap.
 * Replace with org/pricebook coverage when available (bundle LF varies by product).
 */
export const DEFAULT_HIP_RIDGE_CAP_LF_PER_SQUARE = 100

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
