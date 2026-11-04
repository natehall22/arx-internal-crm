import {
  getPublicEstimateBand,
  getPublicEstimatePricePerSquare,
  type PublicEstimateConfidence,
} from '@/lib/public-estimate-config'

export type PublicEstimateCustomerPath =
  | 'auto'
  | 'fallback_unreliable'
  | 'fallback_complex'
  | 'silent_manual'

export type PublicEstimateRevealPath = Exclude<PublicEstimateCustomerPath, 'silent_manual'>

export type PublicEstimatePricingSnapshot = {
  requires_manual_measure: boolean
  squares_mid: number
  facet_count: number
  /** Locked at preview time from the pricebook; null on rows stored before 2026-11. */
  price_per_square?: number | null
  /** Measurement confidence; null on rows stored before 2026-11 (treated as standard/low by path). */
  confidence?: PublicEstimateConfidence | null
}

/** Reliable → auto; unreliable + squares + facets≥10 → complex fallback; unreliable + squares → ordinary fallback; else silent manual. */
export function classifyPublicEstimateCustomerPath(
  snapshot: Pick<PublicEstimatePricingSnapshot, 'requires_manual_measure' | 'squares_mid' | 'facet_count'>
): PublicEstimateCustomerPath {
  if (!snapshot.requires_manual_measure) return 'auto'
  if (snapshot.squares_mid <= 0) return 'silent_manual'
  if (snapshot.facet_count >= 10) return 'fallback_complex'
  return 'fallback_unreliable'
}

export function isPublicEstimateRevealPath(
  path: PublicEstimateCustomerPath
): path is PublicEstimateRevealPath {
  return path !== 'silent_manual'
}

/** Confidence for a snapshot: stored value, else derived from the path (pre-2026-11 rows). */
export function confidenceForSnapshot(
  snapshot: PublicEstimatePricingSnapshot,
  path: PublicEstimateCustomerPath = classifyPublicEstimateCustomerPath(snapshot)
): PublicEstimateConfidence {
  if (snapshot.confidence === 'high' || snapshot.confidence === 'standard' || snapshot.confidence === 'low') {
    // An unreliable measure is never shown as anything better than low.
    return path === 'auto' ? snapshot.confidence : 'low'
  }
  return path === 'auto' ? 'standard' : 'low'
}

/**
 * Central pricing resolver. One rate for every path — the pricebook shingle rate locked at
 * preview time. Uncertainty widens the RANGE (see getPublicEstimateBand) instead of inflating
 * the rate, so the low end never prices above what the roof would actually be sold for.
 */
export function resolvePublicEstimatePricingPath(snapshot: PublicEstimatePricingSnapshot): {
  path: PublicEstimateCustomerPath
  pricePerSquare: number
  confidence: PublicEstimateConfidence
} {
  const path = classifyPublicEstimateCustomerPath(snapshot)
  const stored = Number(snapshot.price_per_square)
  const pricePerSquare = Number.isFinite(stored) && stored > 0 ? stored : getPublicEstimatePricePerSquare()
  return { path, pricePerSquare, confidence: confidenceForSnapshot(snapshot, path) }
}

/** $/sq × squares (with waste) → mid + range by confidence. */
export function computePublicEstimatePricing(
  squaresMid: number,
  pricePerSquare?: number,
  confidence: PublicEstimateConfidence = 'standard'
): {
  squares_mid: number
  squares_low: number
  squares_high: number
  price_per_square: number
  price_mid: number
  price_low: number
  price_high: number
} {
  const band = getPublicEstimateBand(confidence)
  const squares_mid = Math.round(squaresMid * 10) / 10
  const squares_low = Math.round(squaresMid * (1 - band.low) * 10) / 10
  const squares_high = Math.round(squaresMid * (1 + band.high) * 10) / 10
  const resolvedPricePerSquare = pricePerSquare ?? getPublicEstimatePricePerSquare()
  const price_mid = Math.round(squares_mid * resolvedPricePerSquare)
  return {
    squares_mid,
    squares_low,
    squares_high,
    price_per_square: resolvedPricePerSquare,
    price_mid,
    price_low: Math.max(0, Math.round(price_mid * (1 - band.low))),
    price_high: Math.round(price_mid * (1 + band.high)),
  }
}
