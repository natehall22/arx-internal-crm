type ProposalLike = {
  sold_squares?: number | null
  measured_squares?: number | null
  sold_waste_percent?: number | null
}

type ProposalLineItemLike = {
  category?: string | null
  name?: string | null
  description?: string | null
  unit?: string | null
  quantity?: number | null
  is_adder?: boolean | null
}

const SQUARE_UNITS = new Set(['square', 'squares', 'sq'])
const ROOFING_KEYWORDS = ['roof', 'roofing', 'shingle', 'shingles']

function roundSquares(value: number | string | null | undefined): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (n == null || !Number.isFinite(Number(n))) return null
  return Math.round(Number(n) * 100) / 100
}

function parseSquareUnit(unit: string | null | undefined): boolean {
  return SQUARE_UNITS.has((unit || '').trim().toLowerCase())
}

function parseDescriptionValue(description: string | null | undefined, pattern: RegExp): number | null {
  if (!description) return null
  const match = description.match(pattern)
  const parsed = match?.[1] ? Number(match[1]) : NaN
  return Number.isFinite(parsed) ? roundSquares(parsed) : null
}

function looksRoofingRelated(item: ProposalLineItemLike): boolean {
  const haystack = `${item.category || ''} ${item.name || ''} ${item.description || ''}`.toLowerCase()
  return ROOFING_KEYWORDS.some((keyword) => haystack.includes(keyword))
}

export function inferSoldRoofSquaresFromLineItems(lineItems: ProposalLineItemLike[]): number | null {
  const squareItems = lineItems.filter((item) => !item.is_adder && parseSquareUnit(item.unit))
  if (squareItems.length === 0) return null

  for (const item of squareItems) {
    const parsed = parseDescriptionValue(item.description, /=\s*([0-9]+(?:\.[0-9]+)?)\s*sq/i)
    if (parsed != null) return parsed
  }

  const roofingSquareItems = squareItems.filter(looksRoofingRelated)
  const bestCandidate = (roofingSquareItems.length > 0 ? roofingSquareItems : squareItems).reduce<number | null>(
    (best, item) => {
      const quantity = roundSquares(item.quantity)
      if (quantity == null) return best
      if (best == null || quantity > best) return quantity
      return best
    },
    null
  )

  return bestCandidate
}

export function inferMeasuredSquaresFromLineItems(lineItems: ProposalLineItemLike[]): number | null {
  for (const item of lineItems) {
    const parsed = parseDescriptionValue(item.description, /([0-9]+(?:\.[0-9]+)?)\s*sq\s*\+/i)
    if (parsed != null) return parsed
  }
  return null
}

export function inferSoldWastePercentFromLineItems(lineItems: ProposalLineItemLike[]): number | null {
  for (const item of lineItems) {
    const parsed = parseDescriptionValue(item.description, /\+\s*([0-9]+(?:\.[0-9]+)?)%\s*waste/i)
    if (parsed != null) return parsed
  }
  return null
}

export function resolveProposalSoldRoofSquares(
  proposal: ProposalLike | null | undefined,
  lineItems: ProposalLineItemLike[] = []
): number | null {
  return roundSquares(proposal?.sold_squares) ?? inferSoldRoofSquaresFromLineItems(lineItems)
}

export function resolveProposalMeasuredSquares(
  proposal: ProposalLike | null | undefined,
  lineItems: ProposalLineItemLike[] = []
): number | null {
  return roundSquares(proposal?.measured_squares) ?? inferMeasuredSquaresFromLineItems(lineItems)
}

export function resolveProposalWastePercent(
  proposal: ProposalLike | null | undefined,
  lineItems: ProposalLineItemLike[] = []
): number | null {
  return roundSquares(proposal?.sold_waste_percent) ?? inferSoldWastePercentFromLineItems(lineItems)
}
