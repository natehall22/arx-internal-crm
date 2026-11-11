/** The OAuth endpoints as plain functions (token, register, revoke, consent) so tests call them directly; routes are one-liners. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { writeAudit } from '@/lib/ai-connector/audit'
import { authorizeRedirect, checkAuthorizeRequest } from '@/lib/ai-connector/authorize'
import { loadClient, loadExtraRedirectUris, registerClient, validateRegistration, type MetadataFetcher } from '@/lib/ai-connector/clients'
import { AI_CONNECTOR_FEATURE, RATE_LIMITS, UNUSED_CLIENT_DAYS } from '@/lib/ai-connector/config'
import { randomToken, signConsentTicket, verifyConsentTicket } from '@/lib/ai-connector/crypto'
import { createAuthCode, exchangeCode, refreshTokens, revokeByToken, revokeGrant, type OAuthFailure } from '@/lib/ai-connector/store'
import { corsHeaders, mcpResource, requestOrigin } from '@/lib/ai-connector/urls'
import { fenceAllowsOrg, type CompanyFence } from '@/lib/company-host'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { dbOnceGate, dbRateGate, pruneUnusedClients, type OnceGate, type RateGate } from '@/lib/ai-connector/rate-limit'
import { clientIpFromRequest } from '@/lib/public-estimate-rate-limit'

export type EndpointDeps = {
  admin: SupabaseClient
  fence: () => Promise<CompanyFence>
  featureOn?: (orgId: string) => Promise<boolean>
  fetcher?: MetadataFetcher
  now?: number
  /** Counters (default: the database, so limits hold across instances). */
  rate?: RateGate
  once?: OnceGate
}

const rateOf = (d: EndpointDeps): RateGate => d.rate ?? dbRateGate(d.admin, d.now)
const onceOf = (d: EndpointDeps): OnceGate => d.once ?? dbOnceGate(d.admin, d.now ? () => d.now as number : undefined)
const tooMany = (r: { retryAfterSec: number }, error = 'slow_down') => oauthError(error, 'Too many requests', 429, { 'retry-after': String(r.retryAfterSec) })

const featureOn = (d: EndpointDeps, orgId: string) => (d.featureOn ?? ((o: string) => isOrgFeatureOn(o, AI_CONNECTOR_FEATURE)))(orgId)

const oauthError = (error: string, description: string, status = 400, extra: Record<string, string> = {}) =>
  Response.json({ error, error_description: description }, { status, headers: corsHeaders({ pragma: 'no-cache', ...extra }) })

async function readParams(request: Request): Promise<Record<string, string> | null> {
  const type = request.headers.get('content-type') ?? ''
  const text = await request.text()
  if (text.length > 8192) return null
  try {
    if (type.includes('application/json')) {
      const j = JSON.parse(text) as Record<string, unknown>
      return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    }
    return Object.fromEntries(new URLSearchParams(text))
  } catch {
    return null
  }
}

/** The company this address is for (null = the open/legacy single-company address). */
async function fenceOrg(d: EndpointDeps): Promise<{ orgId: string | null } | { error: 'lookup' | 'closed' }> {
  const f = await d.fence()
  if (f.kind === 'org') return { orgId: f.orgId }
  if (f.kind === 'open') return { orgId: null }
  return { error: f.reason === 'lookup_error' ? 'lookup' : 'closed' }
}

/** A person may hold a grant only while: active in the company, the company address allows them, the switch is on. */
async function principalUsable(d: EndpointDeps, orgId: string, userId: string): Promise<boolean> {
  const f = await d.fence()
  if (!fenceAllowsOrg(f, orgId)) return false
  const { data } = await d.admin.from('users').select('id, active').eq('id', userId).eq('org_id', orgId).maybeSingle()
  const u = data as { active?: boolean | null } | null
  if (!u || u.active === false) return false
  return featureOn(d, orgId)
}

/** Sign-in events in the audit log (never blocks the answer; the tool-call log is the one that fails closed). */
async function auditEvent(d: EndpointDeps, who: { orgId: string; userId: string | null; clientId: string | null } | null, tool: string, result: 'ok' | 'denied', detail: string) {
  if (!who) return
  await writeAudit(d.admin, { orgId: who.orgId, userId: who.userId, clientId: who.clientId, tool, result, detail }).catch(() => undefined)
}

export async function handleToken(request: Request, d: EndpointDeps): Promise<Response> {
  const rate = rateOf(d)
  // Loose backstop by address only (shared by every user of an AI app); the real limit is per app, below.
  const byIp = await rate(`oauth:token:ip:${clientIpFromRequest(request)}`, RATE_LIMITS.tokenPerIpPerMinute, 60)
  if (!byIp.ok) return tooMany(byIp)
  const p = await readParams(request)
  if (!p) return oauthError('invalid_request', 'Send a form-encoded body')
  // Redirect addresses the owners added matter at the token step too, so read the company's list for this address.
  const f = await fenceOrg(d)
  if ('error' in f) return oauthError('temporarily_unavailable', 'Try again shortly', f.error === 'lookup' ? 503 : 404)
  const extra = await loadExtraRedirectUris(d.admin, f.orgId)
  const client = await loadClient(d.admin, p.client_id, extra, d.fetcher)
  if (!client) return oauthError('invalid_client', 'Unknown client', 401)
  const byClient = await rate(`oauth:token:client:${client.client_id}`, RATE_LIMITS.clientTokenPerMinute, 60)
  if (!byClient.ok) return tooMany(byClient)
  const resource = p.resource ? p.resource : null
  // The resource, when sent, must be THIS address's MCP endpoint.
  if (resource !== null && resource !== mcpResource(requestOrigin(request))) return oauthError('invalid_target', 'resource must be this MCP server address')

  let outcome: { ok: true; tokens: unknown; grant: { id: string; orgId: string; userId: string } } | ({ ok: false } & OAuthFailure)
  if (p.grant_type === 'authorization_code') {
    if (!p.code || !p.redirect_uri || !p.code_verifier) return oauthError('invalid_request', 'code, redirect_uri and code_verifier are required')
    outcome = await exchangeCode(d.admin, { code: p.code, clientId: client.client_id, redirectUri: p.redirect_uri, codeVerifier: p.code_verifier, resource }, d.now)
  } else if (p.grant_type === 'refresh_token') {
    if (!p.refresh_token) return oauthError('invalid_request', 'refresh_token is required')
    outcome = await refreshTokens(d.admin, { refreshToken: p.refresh_token, clientId: client.client_id, resource }, d.now)
  } else {
    return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
  }
  if (!outcome.ok) {
    await auditEvent(d, outcome.audit ?? null, `oauth.${p.grant_type === 'refresh_token' ? 'refresh' : 'token'}_refused`, 'denied', outcome.description)
    return oauthError(outcome.error, outcome.description)
  }
  // A key for another company's address, a person who was turned off, or a switch turned off: no tokens, grant revoked.
  if (!(await principalUsable(d, outcome.grant.orgId, outcome.grant.userId))) {
    await revokeGrant(d.admin, outcome.grant.orgId, outcome.grant.id, 'principal_unusable', d.now)
    await auditEvent(d, { orgId: outcome.grant.orgId, userId: outcome.grant.userId, clientId: client.client_id }, 'oauth.revoked', 'denied', 'principal_unusable')
    return oauthError('invalid_grant', 'This connection is no longer allowed')
  }
  await auditEvent(d, { orgId: outcome.grant.orgId, userId: outcome.grant.userId, clientId: client.client_id }, p.grant_type === 'refresh_token' ? 'oauth.refresh' : 'oauth.token_issued', 'ok', outcome.grant.id)
  return Response.json(outcome.tokens, { headers: corsHeaders({ pragma: 'no-cache' }) })
}

export async function handleRegister(request: Request, d: EndpointDeps): Promise<Response> {
  const rate = rateOf(d)
  const ip = clientIpFromRequest(request)
  // Registration is anonymous, so it is capped per address per minute and per day, and for everyone per day.
  for (const [key, limit, secs] of [
    [`oauth:register:ip:${ip}`, RATE_LIMITS.registerPerIpPerMinute, 60],
    [`oauth:register:ip-day:${ip}`, RATE_LIMITS.registerPerIpPerDay, 86_400],
    ['oauth:register:global-day', RATE_LIMITS.registerGlobalPerDay, 86_400],
  ] as const) {
    const r = await rate(key, limit, secs)
    if (!r.ok) return tooMany(r, 'temporarily_unavailable')
  }
  const f = await fenceOrg(d)
  if ('error' in f) return oauthError('temporarily_unavailable', 'Try again shortly', f.error === 'lookup' ? 503 : 404)
  if (f.orgId && !(await featureOn(d, f.orgId))) return oauthError('access_denied', 'The AI connector is not turned on for this company', 403)
  const p = await readJson(request)
  const reg = validateRegistration(p, await loadExtraRedirectUris(d.admin, f.orgId))
  if (!reg.ok) return oauthError(reg.error, reg.description)
  const client = await registerClient(d.admin, reg.value)
  if (Math.random() < 0.05) void pruneUnusedClients(d.admin, UNUSED_CLIENT_DAYS)
  return Response.json(
    { client_id: client.client_id, client_name: client.client_name, redirect_uris: client.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor((d.now ?? Date.now()) / 1000) },
    { status: 201, headers: corsHeaders({ pragma: 'no-cache' }) }
  )
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > 8192) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** RFC 7009: always 200, whether or not the key was known; only the app the key was issued to can revoke it. */
export async function handleRevoke(request: Request, d: EndpointDeps): Promise<Response> {
  const p = await readParams(request)
  if (p?.token && p.client_id) await revokeByToken(d.admin, p.token, p.client_id, d.now)
  return new Response(null, { status: 200, headers: corsHeaders() })
}

/* ---- consent (the person at the screen) ---------------------------------------------------------------------------- */

export const CONSENT_TTL_MS = 10 * 60 * 1000

/** What the consent page signs: exactly the request the person saw. */
export function makeConsentTicket(params: Record<string, string | null>, userId: string, now = Date.now()): string {
  // `nonce` makes the approval single-use: it is claimed when the person allows, so one approval mints one code.
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null)) as Record<string, string>
  return signConsentTicket({ ...clean, nonce: randomToken('aon_', 16) }, userId, now + CONSENT_TTL_MS)
}

export async function handleConsent(
  request: Request,
  d: EndpointDeps,
  who: { userId: string; orgId: string }
): Promise<Response> {
  const body = (await readJson(request)) as { ticket?: unknown; decision?: unknown } | null
  const params = verifyConsentTicket(body?.ticket, who.userId, d.now)
  if (!params) return Response.json({ error: 'This approval expired. Start again from your AI app.' }, { status: 400 })
  if (!(await principalUsable(d, who.orgId, who.userId))) return Response.json({ error: 'The AI connector is not turned on for you.' }, { status: 403 })

  const origin = requestOrigin(request)
  const check = await checkAuthorizeRequest(d.admin, params, { issuer: origin, resource: mcpResource(origin), orgId: who.orgId, fetcher: d.fetcher })
  if (!check.ok) return 'redirectTo' in check ? Response.json({ redirect: check.redirectTo }) : Response.json({ error: check.fatal }, { status: 400 })

  const audit = (tool: string) => writeAudit(d.admin, { orgId: who.orgId, userId: who.userId, clientId: check.client.client_id, tool, result: 'ok', detail: check.scopes.join(' ') })
  if (body?.decision !== 'allow') {
    await audit('oauth.deny').catch(() => undefined)
    return Response.json({ redirect: authorizeRedirect(check.params.redirect_uri, origin, { error: 'access_denied', error_description: 'The person declined', state: check.params.state }) })
  }
  const nonce = params.nonce
  if (!nonce || !(await onceOf(d)(`consent:${nonce}`, CONSENT_TTL_MS / 1000 + 60))) {
    return Response.json({ error: 'This approval was already used. Start again from your AI app.' }, { status: 400 })
  }
  const code = await createAuthCode(d.admin, { clientId: check.client.client_id, orgId: who.orgId, userId: who.userId, redirectUri: check.params.redirect_uri, codeChallenge: check.params.code_challenge, resource: check.resource, scopes: check.scopes }, d.now)
  await audit('oauth.allow')
  return Response.json({ redirect: authorizeRedirect(check.params.redirect_uri, origin, { code, state: check.params.state }) })
}
