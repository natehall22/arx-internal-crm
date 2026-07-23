import { NextRequest } from 'next/server'
import {
  PUBLIC_ESTIMATE_GATE_COPY,
  PUBLIC_ESTIMATE_MANUAL_GATE_COPY,
  PUBLIC_ESTIMATE_MANUAL_MEASURE_MESSAGE,
  getPublicEstimateOrgId,
  getPublicEstimateTokenSecret,
  isInPublicEstimateServiceArea,
  isPublicRoofEstimateEnabled,
} from '@/lib/public-estimate-config'
import { publicEstimateJson, publicEstimateOptionsResponse } from '@/lib/public-estimate-cors'
import {
  clientIpFromRequest,
  consumePublicEstimateRateLimit,
} from '@/lib/public-estimate-rate-limit'
import { storePublicEstimatePreview } from '@/lib/public-estimate-preview-store'
import { createPublicEstimateToken } from '@/lib/public-estimate-token'
import {
  measurePublicRoofEstimate,
  newPublicEstimateJti,
} from '@/lib/public-roof-estimate'
import {
  requireTurnstileOnPreview,
  verifyTurnstileToken,
} from '@/lib/public-estimate-turnstile'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function OPTIONS(request: NextRequest) {
  return publicEstimateOptionsResponse(request.headers.get('origin'))
}

/**
 * POST /api/public/estimate/preview
 * Address → geocode → Solar (server) → squares band + signed token.
 * No dollars. No facet polygons. Optional satellite still (base64) for UI only.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')

  if (!isPublicRoofEstimateEnabled()) {
    return publicEstimateJson(
      { error: 'Public roof estimate is not enabled', code: 'disabled' },
      503,
      origin
    )
  }

  const ip = clientIpFromRequest(request)
  const rate = consumePublicEstimateRateLimit({
    key: `preview:${ip}`,
    limit: Number(process.env.PUBLIC_ESTIMATE_PREVIEW_LIMIT_PER_HOUR || 8),
    windowMs: 60 * 60 * 1000,
  })
  if (!rate.ok) {
    return publicEstimateJson(
      { error: 'Too many estimate requests. Try again later.', code: 'rate_limited', retry_after_sec: rate.retryAfterSec },
      429,
      origin
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return publicEstimateJson({ error: 'Invalid JSON', code: 'bad_json' }, 400, origin)
  }

  // Honeypot
  if (typeof body.company === 'string' && body.company.trim()) {
    return publicEstimateJson({ error: 'Rejected', code: 'rejected' }, 400, origin)
  }

  if (requireTurnstileOnPreview()) {
    const turnstile =
      (typeof body.turnstile_token === 'string' && body.turnstile_token) ||
      request.headers.get('cf-turnstile-response')
    const verified = await verifyTurnstileToken(turnstile, ip)
    if (!verified.ok) {
      return publicEstimateJson(
        { error: 'Human verification failed', code: verified.reason },
        403,
        origin
      )
    }
  }

  const address = typeof body.address === 'string' ? body.address.trim() : ''
  if (!address || address.length < 8) {
    return publicEstimateJson(
      { error: 'A full street address is required', code: 'address_required' },
      400,
      origin
    )
  }

  try {
    getPublicEstimateTokenSecret()
    getPublicEstimateOrgId()
  } catch {
    return publicEstimateJson(
      {
        error: 'Public roof estimate is not configured. Please call (704) 313-8834.',
        code: 'misconfigured',
      },
      503,
      origin
    )
  }

  const measured = await measurePublicRoofEstimate(address)
  if (!measured.ok) {
    const status =
      measured.reason === 'geocode_failed' || measured.reason === 'missing_address'
        ? 400
        : measured.reason === 'missing_api_key'
          ? 503
          : 500
    return publicEstimateJson(
      {
        error:
          measured.reason === 'geocode_failed'
            ? 'We could not find that address. Check the spelling and try again.'
            : 'Estimate preview failed. Please try again or call (704) 313-8834.',
        code: measured.reason,
      },
      status,
      origin
    )
  }

  const result = measured.result
  if (!isInPublicEstimateServiceArea(result.lat, result.lng)) {
    return publicEstimateJson(
      {
        error:
          'That address looks outside our service area (Charlotte metro and nearby). Call (704) 313-8834 and we can still help.',
        code: 'out_of_service_area',
      },
      422,
      origin
    )
  }

  const jti = newPublicEstimateJti()
  let snapshot
  try {
    snapshot = await storePublicEstimatePreview({
      jti,
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      squares_mid: result.squares_mid,
      squares_low: result.squares_low,
      squares_high: result.squares_high,
      waste_percent: result.waste_percent,
      facet_count: result.facet_count,
      measure_source: result.measure_source,
      requires_manual_measure: result.requires_manual_measure,
    })
  } catch {
    return publicEstimateJson(
      {
        error: 'Estimate preview failed. Please try again or call (704) 313-8834.',
        code: 'preview_store_failed',
      },
      500,
      origin
    )
  }
  const preview_token = createPublicEstimateToken(jti)

  const manual = result.requires_manual_measure

  // No squares, dollars, or $413 rate — measurement stays server-side until unlock.
  return publicEstimateJson(
    {
      ok: true,
      preview_token,
      address: result.address,
      expires_at: new Date(snapshot.expiresAt).toISOString(),
      message: manual
        ? 'We found your address — your roof needs a manual measure by our design team.'
        : 'We found your roof from aerial imagery.',
      requires_manual_measure: manual,
      manual_measure_message: manual ? PUBLIC_ESTIMATE_MANUAL_MEASURE_MESSAGE : null,
      satellite_image_base64: result.satellite_image_base64,
      satellite_image_mime: result.satellite_image_base64 ? 'image/png' : null,
      gate_copy: manual ? PUBLIC_ESTIMATE_MANUAL_GATE_COPY : PUBLIC_ESTIMATE_GATE_COPY,
    },
    200,
    origin
  )
}
