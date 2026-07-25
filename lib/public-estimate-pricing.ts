import {
  getPublicEstimateComplexFallbackPricePerSquare,
  getPublicEstimateFallbackPricePerSquare,
  getPublicEstimatePricePerSquare,
  PUBLIC_ESTIMATE_RANGE_BAND,
} from '@/lib/public-estimate-config'
import { applyEstimateRange } from '@/lib/public-estimate-token'

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
}

/** Reliable → auto; unreliable + squares + facets≥10 → complex fallback; unreliable + squares → ordinary fallback; else silent manual. */
export function classifyPublicEstimateCustomerPath(
  snapshot: PublicEstimatePricingSnapshot
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

export function getPublicEstimatePricePerSquareForPath(
  path: PublicEstimateCustomerPath
): number {
  if (path === 'fallback_unreliable') return getPublicEstimateFallbackPricePerSquare()
  if (path === 'fallback_complex') return getPublicEstimateComplexFallbackPricePerSquare()
  return getPublicEstimatePricePerSquare()
}

/** Central pricing resolver — path + $/sq from measure diagnostics. */
export function resolvePublicEstimatePricingPath(snapshot: PublicEstimatePricingSnapshot): {
  path: PublicEstimateCustomerPath
  pricePerSquare: number
} {
  const path = classifyPublicEstimateCustomerPath(snapshot)
  return { path, pricePerSquare: getPublicEstimatePricePerSquareForPath(path) }
}

/** Fixed $/sq (env-overridable, default $413 reliable / $530 fallback / $550 complex) × squares → mid + ±band range. */
export function computePublicEstimatePricing(
  squaresMid: number,
  pricePerSquare?: number
): {
  squares_mid: number
  squares_low: number
  squares_high: number
  price_per_square: number
  price_mid: number
  price_low: number
  price_high: number
} {
  const band = PUBLIC_ESTIMATE_RANGE_BAND
  const squares_mid = Math.round(squaresMid * 10) / 10
  const squares_low = Math.round(squaresMid * (1 - band) * 10) / 10
  const squares_high = Math.round(squaresMid * (1 + band) * 10) / 10
  const resolvedPricePerSquare = pricePerSquare ?? getPublicEstimatePricePerSquare()
  const price_mid = Math.round(squares_mid * resolvedPricePerSquare)
  const priceBand = applyEstimateRange(price_mid, band)
  return {
    squares_mid,
    squares_low,
    squares_high,
    price_per_square: resolvedPricePerSquare,
    price_mid,
    price_low: priceBand.low,
    price_high: priceBand.high,
  }
}
