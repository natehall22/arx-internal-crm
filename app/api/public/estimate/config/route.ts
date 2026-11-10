import { NextRequest } from 'next/server'
import {
  getPublicTurnstileSiteKey,
  isPublicEstimateLive,
} from '@/lib/public-estimate-config'
import { publicEstimateJson, publicEstimateOptionsResponse } from '@/lib/public-estimate-cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  return publicEstimateOptionsResponse(request.headers.get('origin'))
}

/**
 * GET /api/public/estimate/config
 *
 * Public, CORS-enabled bootstrap for arxroofing.com Instant Estimate.
 * Returns the Turnstile *site* key (browser-safe) and whether the funnel is on.
 * Secret keys never leave the CRM.
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin')
  return publicEstimateJson(
    {
      turnstile_site_key: getPublicTurnstileSiteKey(),
      // Off when the env switch is off OR the company switched Roof measuring off (Settings → Features).
      enabled: await isPublicEstimateLive(),
    },
    200,
    origin
  )
}
