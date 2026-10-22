import { abcBaseUrl, abcCredentials, abcTokenUrl, ABC_SCOPES } from '@/lib/suppliers/abc/config'
import type { AbcOrderBody } from '@/lib/suppliers/abc/payload'
import type { AbcEnvironment } from '@/lib/suppliers/abc/types'

/**
 * Words the send flow (lib/supplier-orders.ts) reads as "nothing left the CRM": a definite refusal.
 * Everything else thrown from here (timeout, dropped connection, 5xx, an answer with no confirmation)
 * is recorded as UNKNOWN, and the person must check ABC before sending again. NOTHING here retries.
 */
export class AbcRefusedError extends Error {
  /** Typed marker the send flow checks first, so wording changes can never flip refused ↔ unknown. */
  readonly refused = true
  constructor(message: string) {
    super(`ABC refused the order: ${message}`)
  }
}

const TOKEN_TTL_MS = 25 * 60 * 1000 // ABC tokens last 30 minutes
const REQUEST_TIMEOUT_MS = 20_000
const tokens = new Map<AbcEnvironment, { token: string; expiresAt: number }>()

export function clearAbcTokenCache(): void {
  tokens.clear()
}

type Fetch = typeof fetch

async function accessToken(environment: AbcEnvironment, doFetch: Fetch, now: number): Promise<string> {
  const cached = tokens.get(environment)
  if (cached && cached.expiresAt > now) return cached.token
  const creds = abcCredentials(environment)
  if (!creds) throw new AbcRefusedError(`ABC ${environment} credentials are not set up in this deployment`)
  const res = await doFetch(abcTokenUrl(environment), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: ABC_SCOPES }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  // Getting a token places no order, so any failure here is a clean "nothing left".
  if (!res.ok) throw new AbcRefusedError(`could not sign in to ABC (${res.status})`)
  const json = (await res.json().catch(() => null)) as { access_token?: string } | null
  if (!json?.access_token) throw new AbcRefusedError('ABC sign-in did not return a token')
  tokens.set(environment, { token: json.access_token, expiresAt: now + TOKEN_TTL_MS })
  return json.access_token
}

export type AbcSubmitResult = { confirmationNumber: string; message: string | null }

/** Reads ABC's answer. Pure, so the tricky cases are unit tested. */
export function interpretSubmitResponse(status: number, body: unknown): AbcSubmitResult {
  const text = (v: unknown) => (typeof v === 'string' ? v : null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
    throw new AbcRefusedError(`${status} ${text(b.message) ?? text(b.error) ?? text(b.errorMessage) ?? 'the request was not accepted'}`.slice(0, 300))
  }
  if (status !== 200 && status !== 201 && status !== 202) {
    // 5xx and anything unexpected: ABC may or may not have taken it.
    throw new Error(`ABC answered ${status}; it is not known whether the order was received`)
  }
  const failed = Number(b.request?.ordersFailed ?? 0)
  const order = Array.isArray(b.orders) ? b.orders[0] : null
  // A 2xx we cannot read means ABC may well have taken the order: unknown, never "refused".
  if (!order) throw new Error(`ABC answered ${status} but the answer could not be read; it is not known whether the order was received`)
  if (failed > 0) throw new AbcRefusedError(`${text(order.message) ?? 'the order failed'}`.slice(0, 300))
  const confirmation = text(order.confirmationNumber)
  if (!confirmation) throw new Error('ABC answered but gave no confirmation number; it is not known whether the order was received')
  return { confirmationNumber: confirmation, message: text(order.message) }
}

export async function submitAbcOrder(
  environment: AbcEnvironment,
  body: AbcOrderBody[],
  deps: { fetch?: Fetch; now?: () => number } = {}
): Promise<AbcSubmitResult> {
  const doFetch = deps.fetch ?? fetch
  const token = await accessToken(environment, doFetch, (deps.now ?? Date.now)())
  // One attempt. No retry, ever: a second POST after a timeout could place the order twice.
  const res = await doFetch(`${abcBaseUrl(environment)}/api/order/v2/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const json = await res.json().catch(() => null)
  // An old token (revoked/rotated) would otherwise keep failing for its whole cache life.
  if (res.status === 401) tokens.delete(environment)
  return interpretSubmitResponse(res.status, json)
}
