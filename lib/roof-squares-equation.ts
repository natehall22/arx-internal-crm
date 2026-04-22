/** Round to 2 decimals, consistent with proposal sold_squares / measured_squares. */
export function roundRoofSq(n: number): number {
  return Math.round(n * 100) / 100
}

export type RoofSquaresEquation = {
  measure: number | null
  waste: number | null
  total: number
}

/**
 * Parts for "measure sq + waste sq = total sq".
 * Prefers stored total as authoritative when present; waste = total − measure when both exist
 * (matches how ops thinks about bundles). Falls back to measure × waste% when needed.
 */
export function computeRoofSquaresEquation(input: {
  totalSquares: number | null | undefined
  measuredSquares: number | null | undefined
  wastePercent: number | null | undefined
}): RoofSquaresEquation | null {
  const measRaw = input.measuredSquares
  const hasMeas =
    measRaw != null && Number(measRaw) > 0 && Number.isFinite(Number(measRaw))
  const meas = hasMeas ? roundRoofSq(Number(measRaw)) : null

  const pctRaw = input.wastePercent
  const hasPct =
    pctRaw != null && Number(pctRaw) > 0 && Number.isFinite(Number(pctRaw))
  const pct = hasPct ? Number(pctRaw) : null

  const totRaw = input.totalSquares
  const hasTot =
    totRaw != null && Number(totRaw) > 0 && Number.isFinite(Number(totRaw))
  const tot = hasTot ? roundRoofSq(Number(totRaw)) : null

  if (tot != null && meas != null) {
    let waste = roundRoofSq(tot - meas)
    if (waste < 0 && pct != null) {
      const wPct = roundRoofSq(meas * (pct / 100))
      return { measure: meas, waste: wPct, total: roundRoofSq(meas + wPct) }
    }
    if (waste < 0) waste = 0
    return { measure: meas, waste, total: tot }
  }

  if (tot != null && pct != null) {
    const m = roundRoofSq(tot / (1 + pct / 100))
    return { measure: m, waste: roundRoofSq(tot - m), total: tot }
  }

  if (meas != null && pct != null) {
    const w = roundRoofSq(meas * (pct / 100))
    return { measure: meas, waste: w, total: roundRoofSq(meas + w) }
  }

  if (tot != null) {
    return { measure: null, waste: null, total: tot }
  }

  return null
}

export function formatSqPart(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(1)
}
