/** Public website roof-estimate funnel config (not the internal measure tool). */
import { brandServiceRegion, shortNameArticle, type OrgBrand } from '@/lib/org-brand'

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

/**
 * Fallback consumer shingle rate per square (squares INCLUDING waste) when the pricebook
 * can't be read. The live rate is the org's active "Asphalt Shingles" roofing type
 * (lib/public-estimate-rate.ts) so the estimate follows pricebook changes with no deploy.
 * $451.20 = the Asphalt Shingles sell rate since 2026-08-18. Env override wins over both.
 */
export const PUBLIC_ESTIMATE_DEFAULT_PRICE_PER_SQUARE = 451.2

export function getPublicEstimatePriceOverride(): number | null {
  const raw = Number(process.env.PUBLIC_ESTIMATE_PRICE_PER_SQUARE)
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

/** Sync rate (env override → default). Prefer resolvePublicEstimatePricePerSquare() on the server. */
export function getPublicEstimatePricePerSquare(): number {
  return getPublicEstimatePriceOverride() ?? PUBLIC_ESTIMATE_DEFAULT_PRICE_PER_SQUARE
}

/** Name of the pricebook roofing type the estimate prices from. */
export const PUBLIC_ESTIMATE_ROOFING_TYPE_NAME = 'Asphalt Shingles'

export type PublicEstimateConfidence = 'high' | 'standard' | 'low'

/**
 * Price range around the mid, by measurement confidence (2026-11 calibration):
 *  - high: in-house lidar (≈5% squares error vs carrier reports on 9 roofs)
 *  - standard: Google Solar, measure looks reliable
 *  - low: Solar unreliable / complex / stale imagery. Solar has only ever under-read
 *    (Brigstock −5% base, Heritage −17% with waste), so the range leans high instead of
 *    padding the $/sq like the old $530/$550 fallback rates did.
 * Env PUBLIC_ESTIMATE_RANGE_BAND (legacy, symmetric) still overrides "standard" when set.
 */
export function getPublicEstimateBand(confidence: PublicEstimateConfidence | null | undefined): {
  low: number
  high: number
} {
  if (confidence === 'high') return { low: 0.06, high: 0.08 }
  if (confidence === 'low') return { low: 0.1, high: 0.25 }
  const raw = Number(process.env.PUBLIC_ESTIMATE_RANGE_BAND)
  if (Number.isFinite(raw) && raw > 0 && raw < 0.5) return { low: raw, high: raw }
  return { low: 0.08, high: 0.12 }
}

/**
 * Waste the customer is PRICED on (what reps sell), not what crews burn (~10% actual).
 * 2026-11 CRM data, 19 signed roofs: ≤4 sections 10.5% median, 5–9 sections 16%,
 * 10+ sections 22.5%; no hips/valleys 10.3%, 150+ LF hip+valley 21.5%.
 */
export function getPublicEstimateSoldWastePercent(input: {
  facetCount: number
  hipValleyLf?: number | null
}): number {
  const lf = input.hipValleyLf
  if (lf != null && Number.isFinite(lf) && lf >= 0) {
    if (lf >= 150) return 21.5
    if (lf >= 50) return 16
    return 11
  }
  if (input.facetCount >= 10) return 22
  if (input.facetCount >= 5) return 16
  return 11
}

/** Solar imagery older than this many years can miss additions/new roofs → low confidence. */
export const PUBLIC_ESTIMATE_MAX_IMAGERY_AGE_YEARS = 4

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

/** Customer-facing congratulations shown on the company website after unlock (manual path). */
export const PUBLIC_ESTIMATE_MANUAL_MEASURE_MESSAGE =
  'Congratulations! You have a beautiful and complex roof. One of our designers will reach out to you once they have manually drawn your roof.'

/** Preview step message when paid fallback applies (requires_manual_measure stays false for funnel). */
export const PUBLIC_ESTIMATE_FALLBACK_PREVIEW_MESSAGE =
  'We found your roof from aerial imagery. It looks complex — you will see a conservative estimate range next, and we will manually measure on a free inspection to confirm accuracy.'

/** Gate copy for paid fallback paths — range unlock + manual measure for accuracy. No $/sq rate. */
export const PUBLIC_ESTIMATE_FALLBACK_GATE_COPY =
  'Enter your name, email, and phone to see your conservative estimate range. Your roof looks complex from satellite imagery, so we use a buffered estimate — our team will manually measure your roof on a free inspection to confirm accuracy. This is an estimate only — not a quote. Based on roof complexity, the price could be different. One of our reps will reach out soon with a few clarifying, no-pressure questions.'

/** Hybrid disclaimer for paid fallback unlock/reveal — wider range + manual measure. No $/sq rate. */
export function getPublicEstimateFallbackDisclaimer(): string {
  return (
    'This is an estimate only — not a quote. It is based on aerial/satellite imagery, with a wider range for complex roofs — satellite views can under-read square footage. ' +
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
/** `companyShortName` is the org brand's short name (lib/org-brand), e.g. "An <short name> team member…". */
export function getPublicEstimateUnlockNextStepForPath(path: PublicEstimateCustomerPathName, companyShortName: string): string {
  const An = shortNameArticle(companyShortName, true)
  if (path === 'silent_manual') {
    return `One of our designers will reach out once they have manually drawn your roof. ${An} ${companyShortName} team member will call you shortly.`
  }
  if (isPublicEstimatePaidFallbackPath(path)) {
    return `${An} ${companyShortName} team member will call you shortly. We will also follow up with a manual roof measure on a free inspection so your estimate is accurate — estimate only, not a quote.`
  }
  return `${An} ${companyShortName} team member will call you shortly to confirm details and schedule a free inspection.`
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

/** Error copy when the estimate isn't configured (no org row to read): the call line only when a phone is known. */
export function misconfiguredMessage(phone: string): string {
  return `Public roof estimate is not configured.${phone ? ` Please call ${phone}.` : ''}`
}

/** Error copy for an address outside the geofence: the service area and phone come from the org brand. */
export function outOfServiceAreaMessage(brand: Pick<OrgBrand, 'serviceArea' | 'phone'>): string {
  const region = brandServiceRegion(brand)
  const area = region ? ` (${region} and nearby)` : ''
  const call = brand.phone ? ` Call ${brand.phone} and we can still help.` : ''
  return `That address looks outside our service area${area}.${call}`
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
