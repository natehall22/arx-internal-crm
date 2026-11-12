/**
 * Per-square quantity helpers for the proposal builder (one home, so the builder never re-computes them).
 * The sold squares themselves (measured + waste) are computed once in the builder as `totalSquaresWithWaste`.
 */
type SquareLineLike = {
  id: string
  name?: string | null
  unit?: string | null
  quantity?: number | null
}

export const STALE_SQUARES_TOLERANCE = 0.1

export function isPerSquareUnit(unit: string | null | undefined): boolean {
  return ['square', 'squares', 'sq'].includes((unit || '').trim().toLowerCase())
}

/** Ridge/hip cap lines are per-square but deliberately a few tenths of a square; never "stale". */
function isCapLine(item: SquareLineLike): boolean {
  return /-cap-auto$/.test(item.id) || /^(ridge|hip) cap\b/i.test(item.name || '')
}

export type StaleSquareLine = { id: string; name: string; quantity: number; soldSquares: number }

/** Per-square lines whose quantity is more than 10% away from the current sold squares. Read-only. */
export function findStaleSquareLines(items: SquareLineLike[], soldSquares: number): StaleSquareLine[] {
  if (!Number.isFinite(soldSquares) || soldSquares <= 0) return []
  const sold = Math.round(soldSquares * 100) / 100
  return items
    .filter((item) => isPerSquareUnit(item.unit) && !isCapLine(item))
    .filter((item) => Math.abs((Number(item.quantity) || 0) - sold) / sold > STALE_SQUARES_TOLERANCE)
    .map((item) => ({ id: item.id, name: item.name || 'Line', quantity: Number(item.quantity) || 0, soldSquares: sold }))
}

/**
 * Lines left after the tapped roofing type replaces the old roofing installation line.
 * Adders and every other non-installation line stay (adders are picked in a later step).
 */
export function keepLinesWhenRoofingTypeChanges<T extends { name: string; is_adder?: boolean | null }>(prev: T[]): T[] {
  return prev.filter((item) => {
    if (item.is_adder) return true
    const name = item.name.toLowerCase()
    return !name.includes('roofing') && !name.includes('installation')
  })
}
