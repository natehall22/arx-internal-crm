import {
  PUBLIC_ESTIMATE_PRICE_PER_SQUARE,
  PUBLIC_ESTIMATE_RANGE_BAND,
} from '@/lib/public-estimate-config'
import { applyEstimateRange } from '@/lib/public-estimate-token'

/** Fixed $413/sq (env-overridable) × squares → mid + ±band range. */
export function computePublicEstimatePricing(squaresMid: number): {
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
  const price_per_square = PUBLIC_ESTIMATE_PRICE_PER_SQUARE
  const price_mid = Math.round(squares_mid * price_per_square)
  const priceBand = applyEstimateRange(price_mid, band)
  return {
    squares_mid,
    squares_low,
    squares_high,
    price_per_square,
    price_mid,
    price_low: priceBand.low,
    price_high: priceBand.high,
  }
}
