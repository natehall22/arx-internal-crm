import { NextRequest } from 'next/server'
import { getPublicEstimateOrgId, getPublicEstimateDisclaimerForPath, getPublicEstimateUnlockNextStepForPath, isPublicRoofEstimateEnabled } from '@/lib/public-estimate-config'
import { publicEstimateJson, publicEstimateOptionsResponse } from '@/lib/public-estimate-cors'
import {
  clientIpFromRequest,
  consumePublicEstimateRateLimit,
} from '@/lib/public-estimate-rate-limit'
import { createOrGetPublicEstimateLead, resolvePublicEstimateSnapshotForUnlock } from '@/lib/public-estimate-lead'
import { resolvePublicEstimatePricingPath } from '@/lib/public-estimate-pricing'
import { verifyPublicEstimateToken } from '@/lib/public-estimate-token'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function OPTIONS(request: NextRequest) {
  return publicEstimateOptionsResponse(request.headers.get('origin'))
}

function resolveName(body: Record<string, unknown>): string {
  const direct =
    (typeof body.name === 'string' && body.name) ||
    (typeof body.full_name === 'string' && body.full_name) ||
    (typeof body.homeowner_name === 'string' && body.homeowner_name) ||
    ''
  if (direct.trim()) return direct.trim()
  const first =
    (typeof body.first_name === 'string' && body.first_name) ||
    (typeof body.firstName === 'string' && body.firstName) ||
    ''
  const last =
    (typeof body.last_name === 'string' && body.last_name) ||
    (typeof body.lastName === 'string' && body.lastName) ||
    ''
  return [first, last].filter(Boolean).join(' ').trim()
}

/**
 * POST /api/public/estimate/unlock
 * Requires name + email + phone. Address/lat/lng come ONLY from signed preview token.
 * Creates an inbound CRM lead:
 * - auto + paid fallback ($ range shown) → inside-sales auto_assign + CALL NOW alert
 * - silent_manual (no squares) → unassigned in Leads for manual pickup; info@ notified without CALL NOW
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

  try {
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

  const ip = clientIpFromRequest(request)
  const rate = consumePublicEstimateRateLimit({
    key: `unlock:${ip}`,
    limit: Number(process.env.PUBLIC_ESTIMATE_UNLOCK_LIMIT_PER_HOUR || 12),
    windowMs: 60 * 60 * 1000,
  })
  if (!rate.ok) {
    return publicEstimateJson(
      { error: 'Too many requests. Try again later.', code: 'rate_limited', retry_after_sec: rate.retryAfterSec },
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

  if (typeof body.company === 'string' && body.company.trim()) {
    return publicEstimateJson({ error: 'Rejected', code: 'rejected' }, 400, origin)
  }

  // One Turnstile for the funnel: verified on preview. Unlock trusts the signed,
  // short-lived preview_token (+ rate limits) so the visitor is not challenged twice.

  const preview_token = typeof body.preview_token === 'string' ? body.preview_token.trim() : ''
  if (!preview_token) {
    return publicEstimateJson(
      { error: 'Missing preview token — run address preview first', code: 'token_required' },
      400,
      origin
    )
  }

  const tokenCheck = verifyPublicEstimateToken(preview_token)
  if (!tokenCheck.ok) {
    return publicEstimateJson(
      {
        error:
          tokenCheck.reason === 'expired'
            ? 'Your estimate preview expired. Enter the address again.'
            : 'Invalid estimate preview. Enter the address again.',
        code: tokenCheck.reason,
      },
      tokenCheck.reason === 'expired' ? 410 : 401,
      origin
    )
  }

  let snapshot
  try {
    snapshot = await resolvePublicEstimateSnapshotForUnlock(tokenCheck.payload.jti)
  } catch {
    return publicEstimateJson(
      {
        error: 'Could not load your estimate preview. Please try again or call (704) 313-8834.',
        code: 'preview_store_unavailable',
      },
      503,
      origin
    )
  }
  if (!snapshot) {
    return publicEstimateJson(
      {
        error: 'Your estimate preview expired. Enter the address again.',
        code: 'preview_expired',
      },
      410,
      origin
    )
  }

  const name = resolveName(body)
  const email =
    (typeof body.email === 'string' && body.email) ||
    (typeof body.email_address === 'string' && body.email_address) ||
    ''
  const phone =
    (typeof body.phone === 'string' && body.phone) ||
    (typeof body.phone_number === 'string' && body.phone_number) ||
    (typeof body.mobile === 'string' && body.mobile) ||
    ''

  if (!name) {
    return publicEstimateJson(
      { error: 'Name is required', code: 'name_required' },
      400,
      origin
    )
  }
  if (!email.trim() || !email.includes('@')) {
    return publicEstimateJson(
      { error: 'Email is required', code: 'email_required' },
      400,
      origin
    )
  }
  if (!phone.trim() || phone.replace(/\D/g, '').length < 10) {
    return publicEstimateJson(
      { error: 'A valid phone number is required', code: 'phone_required' },
      400,
      origin
    )
  }

  // Ignore any address/lat/lng in the unlock body — token is source of truth.
  const leadResult = await createOrGetPublicEstimateLead({
    snapshot,
    tokenExp: tokenCheck.payload.exp,
    contact: { name, email: email.trim(), phone: phone.trim() },
    previewToken: preview_token,
  })

  if (!leadResult.ok) {
    return publicEstimateJson(
      { error: 'Could not save your estimate request', code: leadResult.reason },
      leadResult.status,
      origin
    )
  }

  const { path: customerPath } = resolvePublicEstimatePricingPath({
    requires_manual_measure: snapshot.requires_manual_measure,
    squares_mid: snapshot.squares_mid,
    facet_count: snapshot.facet_count,
  })
  const disclaimer = getPublicEstimateDisclaimerForPath(customerPath)
  const nextStep = getPublicEstimateUnlockNextStepForPath(customerPath)

  return publicEstimateJson(
    leadResult.estimate_mode === 'manual_design'
      ? {
          ok: true,
          lead_id: leadResult.lead_id,
          created: leadResult.created,
          estimate_mode: 'manual_design',
          manual_measure_message: leadResult.manual_measure_message,
          address: snapshot.address,
          estimate_emailed: leadResult.estimate_emailed,
          disclaimer,
          next_step: nextStep,
        }
      : {
          ok: true,
          lead_id: leadResult.lead_id,
          created: leadResult.created,
          estimate_mode: 'auto',
          estimate_low: leadResult.price_low,
          estimate_high: leadResult.price_high,
          squares_est: leadResult.squares_est,
          address: snapshot.address,
          currency: 'USD',
          disclaimer,
          estimate_emailed: leadResult.estimate_emailed,
          next_step: nextStep,
        },
    200,
    origin
  )
}
