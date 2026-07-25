import crypto from 'crypto'

/**
 * Post-job Google review requests. Shared server-side helpers for composing the
 * message, minting/validating the tracked-link token, and gating on job status.
 *
 * NOTE: server-only (imports `crypto`). Do NOT import this from client components —
 * the review card receives the composed message/link/phone from the API instead.
 */

// ARX Roofing & Exteriors Google Business Profile "leave a review" short link.
// Used as the hard fallback if an org has not set `google_review_url` in settings.
export const DEFAULT_GOOGLE_REVIEW_URL = 'https://g.page/r/CZXGjypqewJ8EBM/review'

export const DEFAULT_REVIEW_MESSAGE_TEMPLATE =
  "Hi {first_name}, it's {rep_first_name} with ARX Roofing! It was a pleasure getting your new roof taken care of, and thank you for trusting us with your home. When you get a quick minute, would you mind sharing your experience on Google? It means the world to me and the team: {link}"

// Production job statuses where a review request is appropriate (job is done).
export const REVIEW_ELIGIBLE_STATUSES = ['complete', 'collected'] as const

export function isReviewEligibleStatus(status: string | null | undefined): boolean {
  return !!status && (REVIEW_ELIGIBLE_STATUSES as readonly string[]).includes(status)
}

// Hosts the /r/<token> redirect is willing to send a customer to. This keeps the
// tracked redirect from ever becoming an open redirect even if an admin fat-fingers
// `google_review_url` in settings.
const ALLOWED_REVIEW_HOSTS = [
  'g.page',
  'google.com',
  'goo.gl',
]

/**
 * Returns `raw` only if it is an https URL pointing at an allowed Google host,
 * otherwise the safe default. Never returns anything derived from request input.
 */
export function resolveReviewRedirectUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_GOOGLE_REVIEW_URL
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return DEFAULT_GOOGLE_REVIEW_URL
  }
  if (url.protocol !== 'https:') return DEFAULT_GOOGLE_REVIEW_URL
  const host = url.hostname.toLowerCase()
  const allowed = ALLOWED_REVIEW_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  return allowed ? url.toString() : DEFAULT_GOOGLE_REVIEW_URL
}

/** URL-safe, unguessable token for the tracked review link. */
export function generateReviewToken(): string {
  return crypto.randomBytes(18).toString('base64url')
}

function replaceAllSafe(input: string, find: string, replacement: string): string {
  return input.split(find).join(replacement)
}

function firstNameOf(full: string | null | undefined, fallback: string): string {
  if (!full || typeof full !== 'string') return fallback
  const token = full.trim().split(/\s+/)[0]
  return token || fallback
}

export function composeReviewMessage(opts: {
  template?: string | null
  customerName?: string | null
  repName?: string | null
  link: string
}): string {
  const template = opts.template && opts.template.trim() ? opts.template : DEFAULT_REVIEW_MESSAGE_TEMPLATE
  const customerFirst = firstNameOf(opts.customerName, 'there')
  const repFirst = opts.repName ? firstNameOf(opts.repName, 'the ARX team') : 'the ARX team'
  let out = replaceAllSafe(template, '{first_name}', customerFirst)
  out = replaceAllSafe(out, '{rep_first_name}', repFirst)
  out = replaceAllSafe(out, '{link}', opts.link)
  return out
}

/**
 * Absolute tracked link the customer taps, e.g. https://app.example.com/api/r/<token>.
 * Lives under /api so it stays public (auth middleware excludes /api) and does NOT
 * collide with /r/<token>, which is the public inspection-report share page.
 */
export function buildTrackedReviewLink(baseUrl: string, token: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '')
  return `${base}/api/r/${token}`
}
