type ProposalLike = {
  sold_squares?: number | null
  measured_squares?: number | null
  sold_waste_percent?: number | null
}

type ProposalLineItemLike = {
  id?: string | null
  category?: string | null
  name?: string | null
  description?: string | null
  unit?: string | null
  quantity?: number | null
  is_adder?: boolean | null
}

const SQUARE_UNITS = new Set(['square', 'squares', 'sq'])

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

/**
 * The ONE line that can stand in for sold squares: the roofing installation line the builder writes
 * (id `roofing-<type>` in the builder; once saved, ids are database ids, so its description
 * "<measured> sq + <waste>% waste = <sold> sq" is the lasting mark). Per-square labor, dump, cap and
 * other lines never feed squares; a roofing line with no mark is not trusted.
 */
const INSTALL_LINE_MARK = /\+\s*[0-9]+(?:\.[0-9]+)?%\s*waste\s*=\s*[0-9]+(?:\.[0-9]+)?\s*sq/i

export function isRoofingInstallationLine(item: ProposalLineItemLike): boolean {
  if (item.is_adder || !parseSquareUnit(item.unit)) return false
  if (typeof item.id === 'string' && item.id.startsWith('roofing-')) return true
  return INSTALL_LINE_MARK.test(item.description || '')
}

/** The roofing installation line's OWN quantity (never the rounded text in its description). */
export function inferSoldRoofSquaresFromLineItems(lineItems: ProposalLineItemLike[]): number | null {
  let best: number | null = null
  for (const item of lineItems.filter(isRoofingInstallationLine)) {
    const quantity = roundSquares(item.quantity)
    if (quantity != null && quantity > 0 && (best == null || quantity > best)) best = quantity
  }
  return best
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
  // Larger of the stored sold squares and the roofing installation line's own quantity (a manual bump
  // above the stored value is what ops orders). Labor, dump, cap and other per-square lines never count.
  const stored = roundSquares(proposal?.sold_squares)
  const installed = inferSoldRoofSquaresFromLineItems(lineItems)
  const candidates = [stored, installed].filter((v): v is number => v != null && v > 0)
  return candidates.length > 0 ? Math.max(...candidates) : null
}

/**
 * Total Squares to prefill on an installation Order Form.
 *
 * Uses the designed sold scope (measured + the waste designed into the proposal), which is
 * what the customer is agreeing to — not `recommended_order_squares`, which rounds up to whole
 * squares for supplier ordering. Falls back to the ordering figure only when no sold scope
 * exists, so the field is still populated rather than left blank for a rep to guess at.
 */
export function resolveContractTotalSquares(
  proposal: (ProposalLike & { recommended_order_squares?: number | null }) | null | undefined,
  lineItems: ProposalLineItemLike[] = []
): number | null {
  const sold = resolveProposalSoldRoofSquares(proposal, lineItems)
  if (sold != null && sold > 0) return sold

  const recommended = roundSquares(proposal?.recommended_order_squares)
  return recommended != null && recommended > 0 ? recommended : null
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
