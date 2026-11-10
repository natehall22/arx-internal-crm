/**
 * Google Calendar connect from a company web address (slice 10).
 *
 * Google sends every user back to ONE fixed redirect URI (GOOGLE_REDIRECT_URI), which is not the company's address,
 * so the session cookie (host-only on purpose) is not there. The connect start therefore writes a signed,
 * short-lived, single-use `state` carrying who asked (user id, org id) and where to return (the company host); the
 * callback trusts that state — never a cookie — after checking:
 *   signature (HMAC-SHA256) → expiry (10 min) → single use (nonce row consumed atomically in `oauth_states`) →
 *   the user still exists, is active and belongs to that org → the return host is that org's own address.
 * Legacy flow (raw user id as state + cookie check) is untouched for the legacy address.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { appBaseDomain, companyAppUrl, hostnameFromHeader } from '@/lib/company-host'

export const OAUTH_STATE_TTL_MS = 10 * 60_000
const VERSION = 1

export type OAuthStatePayload = { v: number; u: string; o: string; h: string; n: string; e: number }

/** OAUTH_STATE_SECRET when set; otherwise a key derived from the service-role key (server-only either way). */
function stateKey(): Buffer | null {
  const explicit = process.env.OAUTH_STATE_SECRET?.trim()
  if (explicit) return Buffer.from(explicit)
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!service) return null
  return createHmac('sha256', service).update('google-oauth-state-v1').digest()
}

const b64 = (b: Buffer) => b.toString('base64url')

function sign(body: string, key: Buffer): string {
  return b64(createHmac('sha256', key).update(body).digest())
}

/** A signed state is `<payload>.<mac>`; the legacy state is a bare user id (no dot). */
export function isSignedOAuthState(state: string): boolean {
  return state.includes('.')
}

/**
 * Create the state for a connect started on a company address and record its nonce. Returns null when the state can't
 * be issued (no key, no nonce store) — the caller must refuse rather than fall back to the cookie flow.
 */
export async function issueOAuthState(
  admin: SupabaseClient,
  input: { userId: string; orgId: string; returnHost: string },
  now = Date.now()
): Promise<string | null> {
  const key = stateKey()
  if (!key) return null
  const payload: OAuthStatePayload = {
    v: VERSION,
    u: input.userId,
    o: input.orgId,
    h: hostnameFromHeader(input.returnHost),
    n: randomUUID(),
    e: now + OAUTH_STATE_TTL_MS,
  }
  const { error } = await admin.from('oauth_states').insert({
    nonce: payload.n,
    user_id: payload.u,
    org_id: payload.o,
    expires_at: new Date(payload.e).toISOString(),
  })
  if (error) {
    console.error('oauth-state: could not record nonce', error.message)
    return null
  }
  const body = b64(Buffer.from(JSON.stringify(payload)))
  return `${body}.${sign(body, key)}`
}

export type OAuthStateCheck =
  | { ok: true; userId: string; orgId: string; returnOrigin: string }
  | { ok: false; reason: 'bad_signature' | 'expired' | 'used' | 'wrong_user' | 'wrong_host' | 'unavailable' }

/** Verify, consume (single use) and authorize a signed state. Never reads a cookie. */
export async function consumeOAuthState(admin: SupabaseClient, state: string, now = Date.now()): Promise<OAuthStateCheck> {
  const key = stateKey()
  if (!key) return { ok: false, reason: 'unavailable' }
  const [body, mac, extra] = state.split('.')
  if (!body || !mac || extra !== undefined) return { ok: false, reason: 'bad_signature' }
  const expected = Buffer.from(sign(body, key))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' }

  let p: OAuthStatePayload
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  if (p.v !== VERSION || typeof p.u !== 'string' || typeof p.o !== 'string' || typeof p.h !== 'string' || typeof p.n !== 'string') {
    return { ok: false, reason: 'bad_signature' }
  }
  if (typeof p.e !== 'number' || p.e <= now) return { ok: false, reason: 'expired' }

  // Single use: only the first callback flips used_at; a replay finds nothing to update.
  const { data: used, error: useError } = await admin
    .from('oauth_states')
    .update({ used_at: new Date(now).toISOString() })
    .eq('nonce', p.n)
    .eq('user_id', p.u)
    .eq('org_id', p.o)
    .is('used_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .select('nonce')
  if (useError) return { ok: false, reason: 'unavailable' }
  if (!used || used.length !== 1) return { ok: false, reason: 'used' }

  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, org_id, active')
    .eq('id', p.u)
    .maybeSingle()
  if (userError) return { ok: false, reason: 'unavailable' }
  if (!user || user.org_id !== p.o || user.active === false) return { ok: false, reason: 'wrong_user' }

  // The return host must be that org's own address — never a host taken from the request.
  const { data: org, error: orgError } = await admin.from('orgs').select('subdomain').eq('id', p.o).maybeSingle()
  if (orgError) return { ok: false, reason: 'unavailable' }
  const origin = companyAppUrl((org as { subdomain?: string | null } | null)?.subdomain ?? null, appBaseDomain())
  if (!origin || new URL(origin).hostname !== p.h) return { ok: false, reason: 'wrong_host' }

  return { ok: true, userId: p.u, orgId: p.o, returnOrigin: origin }
}
