/**
 * Live Instant Estimate shingle rate: env override → the org's active pricebook roofing type
 * ("Asphalt Shingles", per square) → PUBLIC_ESTIMATE_DEFAULT_PRICE_PER_SQUARE.
 * Cached 10 minutes per instance. Never throws — a pricebook hiccup must not break an estimate.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PUBLIC_ESTIMATE_DEFAULT_PRICE_PER_SQUARE,
  PUBLIC_ESTIMATE_ROOFING_TYPE_NAME,
  getPublicEstimatePriceOverride,
} from '@/lib/public-estimate-config'

const TTL_MS = 10 * 60 * 1000
let cache: { orgId: string; rate: number; at: number } | null = null

export async function resolvePublicEstimatePricePerSquare(
  admin: SupabaseClient,
  orgId: string,
  now = Date.now()
): Promise<number> {
  const override = getPublicEstimatePriceOverride()
  if (override != null) return override
  if (cache && cache.orgId === orgId && now - cache.at < TTL_MS) return cache.rate
  let rate = PUBLIC_ESTIMATE_DEFAULT_PRICE_PER_SQUARE
  let ok = false
  try {
    const { data, error } = await admin
      .from('roofing_types')
      .select('unit_price, pricing_unit, updated_at')
      .eq('org_id', orgId)
      .eq('name', PUBLIC_ESTIMATE_ROOFING_TYPE_NAME)
      .eq('active', true)
      .order('updated_at', { ascending: false }) // duplicates: the most recently edited wins
      .limit(1)
      .maybeSingle()
    if (error) {
      console.warn('[public-estimate] pricebook rate read failed; using default', error.message)
    } else if (!data) {
      console.warn(
        `[public-estimate] no active "${PUBLIC_ESTIMATE_ROOFING_TYPE_NAME}" roofing type — website estimate is using the fixed $${PUBLIC_ESTIMATE_DEFAULT_PRICE_PER_SQUARE}/sq. Was it renamed?`
      )
    } else {
      const raw = Number(data.unit_price)
      const perSquare = data.pricing_unit === 'sqft' ? raw * 100 : data.pricing_unit === 'square' ? raw : NaN
      // Only a sane per-square rate is trusted (guards a typo like 45.12 or 4512).
      if (Number.isFinite(perSquare) && perSquare >= 250 && perSquare <= 900) {
        rate = Math.round(perSquare * 100) / 100
        ok = true
      } else {
        console.warn(
          `[public-estimate] "${PUBLIC_ESTIMATE_ROOFING_TYPE_NAME}" rate ${data.unit_price}/${data.pricing_unit} is outside $250–$900/sq — using $${PUBLIC_ESTIMATE_DEFAULT_PRICE_PER_SQUARE}/sq`
        )
      }
    }
  } catch (err) {
    console.warn('[public-estimate] pricebook rate read failed; using default', err)
  }
  // Cache a good read for 10 min; a failed one only briefly so a fix shows up fast.
  cache = { orgId, rate, at: ok ? now : now - TTL_MS + 60_000 }
  return rate
}

/** Test hook. */
export function __resetPublicEstimateRateCache() {
  cache = null
}
