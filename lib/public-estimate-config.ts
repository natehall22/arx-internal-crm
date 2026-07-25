/** Public website roof-estimate funnel config (not the internal measure tool). */

/** ARX org for inbound website estimate leads — must be set explicitly when funnel is enabled. */
export function getPublicEstimateOrgId(): string {
  const orgId = process.env.PUBLIC_ESTIMATE_ORG_ID?.trim()
  if (!orgId) {
    throw new Error(
      'PUBLIC_ESTIMATE_ORG_ID must be set when PUBLIC_ROOF_ESTIMATE_ENABLED=true (do not rely on implicit prod defaults on preview/staging).'
    )
  }
  return orgId
}

/** @deprecated Use getPublicEstimateOrgId() — kept for tests that mock env. */
export const PUBLIC_ESTIMATE_ORG_ID =
  process.env.PUBLIC_ESTIMATE_ORG_ID || '9089d4ad-f46c-405b-9798-6751d45a7051'

/** Fixed consumer shingle rate — not pricebook / margin stack. */
export function getPublicEstimatePricePerSquare(): number {
  const raw = Number(process.env.PUBLIC_ESTIMATE_PRICE_PER_SQUARE)
  return Number.isFinite(raw) && raw > 0 ? raw : 413
}

export const PUBLIC_ESTIMATE_PRICE_PER_SQUARE = getPublicEstimatePricePerSquare()

/** Fallback shingle rate when auto-measure is unreliable but squares_mid > 0 (facet_count < 10). */
export function getPublicEstimateFallbackPricePerSquare(): number {
  const raw = Number(process.env.PUBLIC_ESTIMATE_FALLBACK_PRICE_PER_SQUARE)
  return Number.isFinite(raw) && raw > 0 ? raw : 530
}

/** Complex fallback shingle rate when auto-measure is unreliable with squares_mid > 0 and facet_count ≥ 10. */
export function getPublicEstimateComplexFallbackPricePerSquare(): number {
  const raw = Number(process.env.PUBLIC_ESTIMATE_COMPLEX_FALLBACK_PRICE_PER_SQUARE)
  return Number.isFinite(raw) && raw > 0 ? raw : 550
}

/** ± band around mid price / squares (aligned with measure accuracy docs ~±15%). */
export const PUBLIC_ESTIMATE_RANGE_BAND = (() => {
  const raw = Number(process.env.PUBLIC_ESTIMATE_RANGE_BAND)
  return Number.isFinite(raw) && raw > 0 && raw < 0.5 ? raw : 0.15
})()

export const PUBLIC_ESTIMATE_TOKEN_TTL_MS = (() => {
  const raw = Number(process.env.PUBLIC_ESTIMATE_TOKEN_TTL_MS)
  return Number.isFinite(raw) && raw >= 60_000 ? raw : 20 * 60 * 1000
})()

export const PUBLIC_ESTIMATE_LEAD_SOURCE_NAME = 'Website Instant Estimate'

/**
 * Silent-manual path only (complex roof, no dollar range shown to customer).
 * Separate from Website Instant Estimate so these do NOT inherit inside-sales auto_assign.
 * Paid fallback paths (fallback_unreliable / fallback_complex) use Website Instant Estimate.
 */
export const PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME =
  'Website Instant Estimate — Manual Measure'

/** Lead source name used when unlocking an Instant Estimate. */
export function getPublicEstimateLeadSourceName(requiresManualMeasure: boolean): string {
  return requiresManualMeasure
    ? PUBLIC_ESTIMATE_MANUAL_LEAD_SOURCE_NAME
    : PUBLIC_ESTIMATE_LEAD_SOURCE_NAME
}

/** Default residential pitch when Solar does not report one (6/12). */
export const PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE = 6

export const PUBLIC_ESTIMATE_SATELLITE_ZOOM = 20
export const PUBLIC_ESTIMATE_SATELLITE_SIZE = 640

/** Charlotte metro + nearby suburbs ARX serves. */
export const PUBLIC_ESTIMATE_SERVICE_AREA = {
  latMin: 34.85,
  latMax: 35.65,
  lngMin: -81.35,
  lngMax: -80.35,
} as const

/** Full disclaimer shown when dollar range is revealed (+ CRM notes / homeowner email). No $/sq rate. */
export function getPublicEstimateDisclaimer(): string {
  return (
    'This is an estimate only — not a quote. It is based on aerial/satellite imagery of your roof. ' +
    'Based on roof complexity, the price could be different. Pitch, condition, and complexity are verified on a free inspection. ' +
    'This range is for roofing (shingles) only; extras like gutters, decking, or tear-off are separate and confirmed after inspection. ' +
    'One of our reps will reach out soon to ask some clarifying, no-pressure questions.'
  )
}

/** Default disclaimer at module load. */
export const PUBLIC_ESTIMATE_DISCLAIMER = getPublicEstimateDisclaimer()

/** Short copy near the contact gate (before dollars). No $/sq rate. */
export const PUBLIC_ESTIMATE_GATE_COPY =
  'Enter your name, email, and phone to see your estimate range. This is an estimate only — not a quote. Based on roof complexity, the price could be different. One of our reps will reach out soon with a few clarifying, no-pressure questions.'

/** Gate copy when automated estimate is unreliable — no dollar range promised. */
export const PUBLIC_ESTIMATE_MANUAL_GATE_COPY =
  'Enter your name, email, and phone so we can follow up with next steps. Your roof needs a manual measure by our design team — we will not show an instant dollar range here.'

/** Customer-facing congratulations shown on arxroofing.com after unlock (manual path). */
export const PUBLIC_ESTIMATE_MANUAL_MEASURE_MESSAGE =
  'Congratulations! You have a beautiful and complex roof. One of our designers will reach out to you once they have manually drawn your roof.'

/** Preview step message when paid fallback applies (requires_manual_measure stays false for funnel). */
export const PUBLIC_ESTIMATE_FALLBACK_PREVIEW_MESSAGE =
  'We found your roof from aerial imagery. It looks complex — you will see a conservative estimate range next, and we will manually measure on a free inspection to confirm accuracy.'

/** Gate copy for paid fallback paths — range unlock + manual measure for accuracy. No $/sq rate. */
export const PUBLIC_ESTIMATE_FALLBACK_GATE_COPY =
  'Enter your name, email, and phone to see your conservative estimate range. Your roof looks complex from satellite imagery, so we use a buffered estimate — our team will manually measure your roof on a free inspection to confirm accuracy. This is an estimate only — not a quote. Based on roof complexity, the price could be different. One of our reps will reach out soon with a few clarifying, no-pressure questions.'

/** Hybrid disclaimer for paid fallback unlock/reveal — conservative range + manual measure. No $/sq rate. */
export function getPublicEstimateFallbackDisclaimer(): string {
  return (
    'This is an estimate only — not a quote. It is based on aerial/satellite imagery and a conservative rate for complex roofs — satellite views can under-read square footage. ' +
    'Our design team will manually measure your roof on a free inspection to confirm accuracy before any quote. ' +
    'Based on roof complexity, the price could be different. Pitch, condition, and complexity are verified on inspection. ' +
    'This range is for roofing (shingles) only; extras like gutters, decking, or tear-off are separate and confirmed after inspection. ' +
    'One of our reps will reach out soon to ask some clarifying, no-pressure questions.'
  )
}

export type PublicEstimateCustomerPathName =
  | 'auto'
  | 'fallback_unreliable'
  | 'fallback_complex'
  | 'silent_manual'

export function isPublicEstimatePaidFallbackPath(
  path: PublicEstimateCustomerPathName
): path is 'fallback_unreliable' | 'fallback_complex' {
  return path === 'fallback_unreliable' || path === 'fallback_complex'
}

export function getPublicEstimateDisclaimerForPath(path: PublicEstimateCustomerPathName): string {
  if (isPublicEstimatePaidFallbackPath(path)) return getPublicEstimateFallbackDisclaimer()
  return getPublicEstimateDisclaimer()
}

export function getPublicEstimateGateCopyForPath(path: PublicEstimateCustomerPathName): string {
  if (path === 'silent_manual') return PUBLIC_ESTIMATE_MANUAL_GATE_COPY
  if (isPublicEstimatePaidFallbackPath(path)) return PUBLIC_ESTIMATE_FALLBACK_GATE_COPY
  return PUBLIC_ESTIMATE_GATE_COPY
}

export function getPublicEstimatePreviewMessageForPath(path: PublicEstimateCustomerPathName): string {
  if (path === 'silent_manual') {
    return 'We found your address — your roof needs a manual measure by our design team.'
  }
  if (isPublicEstimatePaidFallbackPath(path)) return PUBLIC_ESTIMATE_FALLBACK_PREVIEW_MESSAGE
  return 'We found your roof from aerial imagery.'
}

/** Post-unlock next_step copy returned to the website reveal/manual steps. */
export function getPublicEstimateUnlockNextStepForPath(path: PublicEstimateCustomerPathName): string {
  if (path === 'silent_manual') {
    return 'One of our designers will reach out once they have manually drawn your roof. An ARX team member will call you shortly.'
  }
  if (isPublicEstimatePaidFallbackPath(path)) {
    return 'An ARX team member will call you shortly. We will also follow up with a manual roof measure on a free inspection so your estimate is accurate — estimate only, not a quote.'
  }
  return 'An ARX team member will call you shortly to confirm details and schedule a free inspection.'
}

export const PUBLIC_ESTIMATE_ALLOWED_ORIGINS = [
  'https://arxroofing.com',
  'https://www.arxroofing.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const

export function isPublicRoofEstimateEnabled(): boolean {
  return process.env.PUBLIC_ROOF_ESTIMATE_ENABLED === 'true'
}

/**
 * Public Cloudflare Turnstile site key for the website funnel widget.
 * Browser-safe — never confuse with TURNSTILE_SECRET_KEY.
 * Website fetches this via GET /api/public/estimate/config (holds no keys itself).
 *
 * Env precedence:
 *   TURNSTILE_SITE_KEY
 *   PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY
 *   VITE_TURNSTILE_SITE_KEY  (legacy name already set on CRM Vercel)
 */
export function getPublicTurnstileSiteKey(): string | null {
  const key =
    process.env.TURNSTILE_SITE_KEY?.trim() ||
    process.env.PUBLIC_ESTIMATE_TURNSTILE_SITE_KEY?.trim() ||
    process.env.VITE_TURNSTILE_SITE_KEY?.trim() ||
    ''
  return key || null
}

export function isInPublicEstimateServiceArea(lat: number, lng: number): boolean {
  const { latMin, latMax, lngMin, lngMax } = PUBLIC_ESTIMATE_SERVICE_AREA
  return lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax
}

export function getPublicEstimateTokenSecret(): string {
  const secret = process.env.PUBLIC_ESTIMATE_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'PUBLIC_ESTIMATE_TOKEN_SECRET must be set to a dedicated secret (≥32 chars). Do not reuse webhook or service-role keys.'
    )
  }
  return secret
}

/** @deprecated Prefer getCrmEmailFrom — Instant Estimate uses the shared CRM From. */
export { getCrmEmailFrom as getPublicEstimateMailFrom } from '@/lib/crm-email-from'
