/**
 * The ONE door to Intuit's OAuth + company-info endpoints (fetch only, no SDK). Later PRs add the accounting calls here.
 * Never logs a token or the client secret. Every call has a timeout; a timeout / network error / 5xx is `unknown`
 * (nobody learned anything), never "revoked".
 */
import { INTUIT_AUTH_URL, INTUIT_REVOKE_URL, INTUIT_TOKEN_URL, QB_MINOR_VERSION, QB_SCOPE, quickBooksApiBase, type QbConfig, type QbEnvironment } from './config'

const TIMEOUT_MS = 15_000

export type IntuitTokens = { accessToken: string; refreshToken: string; accessExpiresInSec: number; refreshExpiresInSec: number }

export type IntuitFailure = { ok: false; kind: 'invalid_grant' | 'rejected' | 'unknown'; status: number; message: string }
export type IntuitResult<T> = ({ ok: true } & T) | IntuitFailure

/** The consent-screen URL. `state` is the signed single-use ticket (lib/google-oauth-state.ts, purpose 'quickbooks'). */
export function buildAuthorizeUrl(cfg: QbConfig, state: string): string {
  const u = new URL(INTUIT_AUTH_URL)
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', QB_SCOPE)
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('state', state)
  return u.toString()
}

function basic(cfg: QbConfig): string {
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`
}

async function post(url: string, cfg: QbConfig, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: basic(cfg), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, body }
  } catch {
    return null
  }
}

function failure(r: { status: number; body: Record<string, unknown> } | null): IntuitFailure {
  if (!r) return { ok: false, kind: 'unknown', status: 0, message: 'No answer from Intuit' }
  const code = typeof r.body.error === 'string' ? r.body.error : ''
  if (r.status === 400 && code === 'invalid_grant') return { ok: false, kind: 'invalid_grant', status: 400, message: 'invalid_grant' }
  // 5xx / 429 = Intuit's side or a throttle: nothing learned about the token.
  if (r.status >= 500 || r.status === 429) return { ok: false, kind: 'unknown', status: r.status, message: `Intuit answered ${r.status}` }
  return { ok: false, kind: 'rejected', status: r.status, message: code || `Intuit answered ${r.status}` }
}

function readTokens(body: Record<string, unknown>): IntuitTokens | null {
  const accessToken = body.access_token
  const refreshToken = body.refresh_token
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || !accessToken || !refreshToken) return null
  const access = Number(body.expires_in)
  const refresh = Number(body.x_refresh_token_expires_in)
  return {
    accessToken,
    refreshToken,
    accessExpiresInSec: Number.isFinite(access) && access > 0 ? access : 3600,
    // Intuit sends this in seconds; if it is ever missing assume the shorter old 100-day rule rather than 5 years.
    refreshExpiresInSec: Number.isFinite(refresh) && refresh > 0 ? refresh : 100 * 86_400,
  }
}

export async function exchangeCode(cfg: QbConfig, code: string): Promise<IntuitResult<{ tokens: IntuitTokens }>> {
  const r = await post(INTUIT_TOKEN_URL, cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri })
  if (!r || r.status !== 200) return failure(r)
  const tokens = readTokens(r.body)
  return tokens ? { ok: true, tokens } : { ok: false, kind: 'rejected', status: r.status, message: 'Intuit sent no tokens' }
}

/** Every successful refresh returns a NEW refresh token; the caller must store it before using anything else. */
export async function refreshTokens(cfg: QbConfig, refreshToken: string): Promise<IntuitResult<{ tokens: IntuitTokens }>> {
  const r = await post(INTUIT_TOKEN_URL, cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
  if (!r || r.status !== 200) return failure(r)
  const tokens = readTokens(r.body)
  return tokens ? { ok: true, tokens } : { ok: false, kind: 'rejected', status: r.status, message: 'Intuit sent no tokens' }
}

/** Revoke a token at Intuit (disconnect). Revoking the refresh token ends the whole grant. */
export async function revokeToken(cfg: QbConfig, token: string): Promise<IntuitResult<Record<string, never>>> {
  const r = await post(INTUIT_REVOKE_URL, cfg, { token })
  if (r && r.status === 200) return { ok: true }
  // Already revoked / expired at Intuit's side = what we wanted.
  if (r && r.status === 400) return { ok: true }
  return failure(r)
}

/** Proves the token works for this realm and names the QuickBooks company. */
export async function fetchCompanyName(environment: QbEnvironment, realmId: string, accessToken: string): Promise<IntuitResult<{ name: string | null }>> {
  try {
    const url = `${quickBooksApiBase(environment)}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=${QB_MINOR_VERSION}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
    if (res.status === 401 || res.status === 403) return { ok: false, kind: 'rejected', status: res.status, message: 'Intuit refused the token for this company' }
    if (!res.ok) return { ok: false, kind: 'unknown', status: res.status, message: `Intuit answered ${res.status}` }
    const body = (await res.json().catch(() => ({}))) as { CompanyInfo?: { CompanyName?: unknown; LegalName?: unknown } }
    const n = body.CompanyInfo?.CompanyName ?? body.CompanyInfo?.LegalName
    return { ok: true, name: typeof n === 'string' && n.trim() ? n.trim().slice(0, 200) : null }
  } catch {
    return { ok: false, kind: 'unknown', status: 0, message: 'No answer from Intuit' }
  }
}
