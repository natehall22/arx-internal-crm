/**
 * Sign-in request rules (the authorization endpoint). Order matters: until the app and its redirect address are proven good
 * we NEVER redirect (an error is shown on our own page); after that, errors go back to the app as OAuth errors.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { AI_SCOPES, DEFAULT_SCOPES } from '@/lib/ai-connector/config'
import { isAllowedRedirectUri, loadClient, loadExtraRedirectUris, type AiClient, type MetadataFetcher } from '@/lib/ai-connector/clients'
import { isValidCodeChallenge } from '@/lib/ai-connector/crypto'

export type AuthorizeParams = {
  client_id: string
  redirect_uri: string
  code_challenge: string
  state: string | null
  scope: string | null
  resource: string | null
}

type Sp = Record<string, string | string[] | undefined> | URLSearchParams
const one = (sp: Sp, k: string): string | null => {
  const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k]
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : null
}

export type AuthorizeCheck =
  | { ok: true; params: AuthorizeParams; client: AiClient; scopes: string[]; resource: string }
  | { ok: false; fatal: string }
  | { ok: false; fatal?: undefined; redirectTo: string; error: string; description: string }

export function authorizeRedirect(redirectUri: string, issuer: string, q: Record<string, string | null>): string {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(q)) if (v !== null) u.searchParams.set(k, v)
  // RFC 9207: tells the app which sign-in server answered (ChatGPT and Claude compare it exactly).
  u.searchParams.set('iss', issuer)
  return u.toString()
}

export function scopesFor(requested: string | null): string[] {
  const asked = (requested ?? '').split(/\s+/).filter(Boolean)
  const granted = asked.filter((s) => (AI_SCOPES as readonly string[]).includes(s))
  // Looking things up is always part of a connection; `crm:write` is only ever an addition the person approves (handleConsent).
  return Array.from(new Set(granted.length > 0 ? ['crm:read', ...granted] : [...DEFAULT_SCOPES]))
}

export async function checkAuthorizeRequest(
  admin: SupabaseClient,
  sp: Sp,
  ctx: { issuer: string; resource: string; orgId: string | null; fetcher?: MetadataFetcher }
): Promise<AuthorizeCheck> {
  const clientId = one(sp, 'client_id')
  const redirectUri = one(sp, 'redirect_uri')
  const extra = await loadExtraRedirectUris(admin, ctx.orgId)
  const client = clientId ? await loadClient(admin, clientId, extra, ctx.fetcher) : null
  if (!client) return { ok: false, fatal: 'This app is not registered with us. Remove the connection in your AI app and add it again.' }
  // Exact match against what the app registered AND against what this company allows right now.
  if (!redirectUri || !client.redirect_uris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri, extra)) {
    return { ok: false, fatal: 'This app asked to send you back to an address that is not allowed. Nothing was shared.' }
  }
  const state = one(sp, 'state')
  if (state !== null && state.length > 512) return { ok: false, fatal: 'The request was too long.' }
  const fail = (error: string, description: string): AuthorizeCheck => ({ ok: false, redirectTo: authorizeRedirect(redirectUri, ctx.issuer, { error, error_description: description, state }), error, description })

  if (one(sp, 'response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')
  const challenge = one(sp, 'code_challenge')
  if (!isValidCodeChallenge(challenge)) return fail('invalid_request', 'A PKCE code_challenge is required')
  if (one(sp, 'code_challenge_method') !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256')
  const resource = one(sp, 'resource')
  // Audience binding: the app must ask for THIS address's MCP endpoint (or leave it out, and we bind to it).
  if (resource !== null && resource !== ctx.resource) return fail('invalid_target', 'resource must be this MCP server address')

  return {
    ok: true,
    client,
    scopes: scopesFor(one(sp, 'scope')),
    resource: ctx.resource,
    params: { client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, state, scope: one(sp, 'scope'), resource },
  }
}
