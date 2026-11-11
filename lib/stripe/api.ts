/**
 * The ONE door to Stripe's REST API (server only). No SDK: Stripe's API is form-encoded HTTP, and the few calls we make
 * (accounts, account links, checkout sessions, payment intents, customers, refunds) do not justify a dependency.
 *
 * - Keys come from env only: STRIPE_SECRET_KEY (sk_test_… first; never in code), STRIPE_WEBHOOK_SECRET (whsec_…).
 * - `account` = a connected account id → `Stripe-Account` header (direct charges on the company's own account:
 *   https://docs.stripe.com/connect/direct-charges).
 * - The API version is pinned so response/webhook shapes don't move under us; create the Connect webhook endpoint with
 *   the same version (docs/online-payments.md).
 * - STRIPE_API_BASE overrides the host for stripe-mock in tests.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export const STRIPE_API_VERSION = '2024-06-20'

export class StripeApiError extends Error {
  status: number
  type: string | null
  code: string | null
  declineCode: string | null
  param: string | null
  /** For card errors on confirm: the PaymentIntent Stripe created (its id lets us record the failure). */
  paymentIntent: StripeObject | null
  constructor(status: number, body: StripeObject | null, fallback: string) {
    const err = (body?.error ?? {}) as StripeObject
    super(typeof err.message === 'string' ? err.message : fallback)
    this.status = status
    this.type = typeof err.type === 'string' ? err.type : null
    this.code = typeof err.code === 'string' ? err.code : null
    this.declineCode = typeof err.decline_code === 'string' ? err.decline_code : null
    this.param = typeof err.param === 'string' ? err.param : null
    this.paymentIntent = err.payment_intent && typeof err.payment_intent === 'object' ? (err.payment_intent as StripeObject) : null
  }
}

// Stripe's JSON is read field by field with runtime checks; `any` keeps those reads short.
export type StripeObject = Record<string, any>

export function stripeSecretKey(): string | null {
  const k = process.env.STRIPE_SECRET_KEY?.trim()
  return k ? k : null
}

export function stripeConfigured(): boolean {
  return !!stripeSecretKey()
}

/** Test keys (sk_test_ / rk_test_) → test mode. Used to label rows and refuse a live/test mix-up. */
export function stripeKeyIsLive(): boolean {
  return /^(sk|rk)_live_/.test(stripeSecretKey() ?? '')
}

type Params = Record<string, unknown>

/** Pure: Stripe's bracket form encoding (`a[b][0][c]=x`). undefined/null are left out; booleans are "true"/"false". */
export function encodeStripeForm(params: Params): string {
  const out: string[] = []
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(`${prefix}[${i}]`, item))
      return
    }
    if (typeof v === 'object') {
      for (const [k, inner] of Object.entries(v as Params)) walk(`${prefix}[${k}]`, inner)
      return
    }
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`)
  }
  for (const [k, v] of Object.entries(params)) walk(k, v)
  return out.join('&')
}

export type StripeRequestOptions = {
  /** Connected account id (acct_…) for direct charges / objects on the company's account. */
  account?: string | null
  /** Stripe idempotency key: a retried POST with the same key never makes a second object or charge. */
  idempotencyKey?: string | null
  /** Override the host (OAuth-style endpoints); defaults to STRIPE_API_BASE or api.stripe.com. */
  base?: string
}

export async function stripeRequest<T extends StripeObject = StripeObject>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Params = {},
  opts: StripeRequestOptions = {}
): Promise<T> {
  const key = stripeSecretKey()
  if (!key) throw new StripeApiError(503, null, 'Online payments are not set up (STRIPE_SECRET_KEY)')
  const base = (opts.base ?? process.env.STRIPE_API_BASE ?? 'https://api.stripe.com').replace(/\/+$/, '')
  const form = encodeStripeForm(params)
  const url = method === 'GET' && form ? `${base}${path}?${form}` : `${base}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Stripe-Version': STRIPE_API_VERSION,
  }
  if (opts.account) headers['Stripe-Account'] = opts.account
  if (opts.idempotencyKey && method === 'POST') headers['Idempotency-Key'] = opts.idempotencyKey
  if (method !== 'GET') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  const res = await fetch(url, { method, headers, body: method === 'GET' ? undefined : form, cache: 'no-store' })
  const text = await res.text()
  let body: StripeObject | null = null
  try {
    body = text ? (JSON.parse(text) as StripeObject) : null
  } catch {
    body = null
  }
  if (!res.ok) throw new StripeApiError(res.status, body, `Stripe request failed (${res.status})`)
  return (body ?? {}) as T
}

/**
 * Pure: check a `Stripe-Signature` header (`t=…,v1=…[,v1=…]`) against the raw body. Signed payload = `${t}.${body}`,
 * HMAC-SHA256 with the endpoint secret, hex; any v1 may match (secret rolling); constant-time compare; the timestamp
 * must be within `toleranceSec` of now (replay guard, Stripe's libraries default to 300 s).
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec = 300
): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: 'no_secret' }
  if (!header) return { ok: false, reason: 'no_header' }
  let t: number | null = null
  const v1: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 't' && /^\d+$/.test(v)) t = Number(v)
    else if (k === 'v1' && /^[0-9a-f]+$/i.test(v)) v1.push(v.toLowerCase())
  }
  if (t === null || v1.length === 0) return { ok: false, reason: 'bad_header' }
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: 'stale' }
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex'), 'utf8')
  for (const sig of v1) {
    const got = Buffer.from(sig, 'utf8')
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true }
  }
  return { ok: false, reason: 'mismatch' }
}
