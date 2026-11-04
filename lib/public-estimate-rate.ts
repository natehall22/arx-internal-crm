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
  try {
    const { data, error } = await admin
      .from('roofing_types')
      .select('unit_price, pricing_unit')
      .eq('org_id', orgId)
      .eq('name', PUBLIC_ESTIMATE_ROOFING_TYPE_NAME)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    const price = Number(data?.unit_price)
    // Only a per-square rate in a sane band is trusted (guards a typo like 45.12 or 4512).
    if (!error && data?.pricing_unit === 'square' && Number.isFinite(price) && price >= 250 && price <= 900) {
      rate = Math.round(price * 100) / 100
    } else if (error) {
      console.warn('[public-estimate] pricebook rate read failed; using default', error.message)
    }
  } catch (err) {
    console.warn('[public-estimate] pricebook rate read failed; using default', err)
  }
  cache = { orgId, rate, at: now }
  return rate
}

/** Test hook. */
export function __resetPublicEstimateRateCache() {
  cache = null
}
