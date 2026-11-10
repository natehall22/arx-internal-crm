/**
 * Google Calendar connect from a company web address (slice 10).
 *
 * Google sends every user back to ONE fixed redirect URI (GOOGLE_REDIRECT_URI), which is not the company's address,
 * so the session cookie (host-only on purpose) isn't there. Three steps, each bound to the one before:
 *
 *  1. start  (company address, signed in): `issueOAuthState` records a nonce row in `oauth_states` and returns a
 *     signed (HMAC-SHA256), 10-minute ticket {user, org, return host, nonce}. The start route also sets an httpOnly,
 *     host-only cookie holding the nonce in THIS browser.
 *  2. callback (fixed redirect host, no cookie): `acceptOAuthCallback` checks signature → expiry → user still in that
 *     org and active → return host is that org's own address, then parks Google's one-time code on the nonce row
 *     (AES-256-GCM, server-only, once per ticket). Nothing is stored as a connection yet. The browser is sent to
 *     `<company address>/api/auth/google/finish?nonce=…`.
 *  3. finish (company address): `finishOAuthConnect` consumes the row exactly once and hands back the code ONLY when
 *     the browser holds the nonce cookie from step 1 AND the signed-in user/org is the ticket's. Anything else
 *     discards the row. So a consent link someone else started (shared/forwarded) can never attach the clicker's
 *     Google account to the starter's CRM user.
 *
 * The legacy address keeps its original flow (state = user id, cookie on the same host). Rows past expiry are pruned
 * on every new ticket.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { appBaseDomain, companyAppUrl, hostnameFromHeader } from '@/lib/company-host'

export const OAUTH_STATE_TTL_MS = 10 * 60_000
/** httpOnly, host-only cookie that binds a connect to the browser that started it. */
export const GOOGLE_CONNECT_COOKIE = 'gcal_connect_nonce'
export const GOOGLE_CONNECT_COOKIE_PATH = '/api/auth/google'
const VERSION = 1

export type OAuthStatePayload = { v: number; u: string; o: string; h: string; n: string; e: number }

/** OAUTH_STATE_SECRET when set; otherwise a key derived from the service-role key (server-only either way). */
function rootKey(): Buffer | null {
  const explicit = process.env.OAUTH_STATE_SECRET?.trim()
  if (explicit) return Buffer.from(explicit)
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!service) return null
  return createHmac('sha256', service).update('google-oauth-state-v1').digest()
}

function subKey(label: string): Buffer | null {
  const root = rootKey()
  return root ? createHmac('sha256', root).update(label).digest() : null
}

const b64 = (b: Buffer) => b.toString('base64url')

function sign(body: string, key: Buffer): string {
  return b64(createHmac('sha256', key).update(body).digest())
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function sealCode(code: string): string | null {
  const key = subKey('code-seal')
  if (!key) return null
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(code, 'utf8'), c.final()])
  return [b64(iv), b64(ct), b64(c.getAuthTag())].join('.')
}

function openCode(sealed: string): string | null {
  const key = subKey('code-seal')
  if (!key) return null
  try {
    const [iv, ct, tag] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** A signed state is `<payload>.<mac>`; the legacy state is a bare user id (no dot). */
export function isSignedOAuthState(state: string): boolean {
  return state.includes('.')
}

/**
 * Step 1. Create the ticket for a connect started on a company address, record its nonce, prune expired rows.
 * Null when it can't be issued (no key, no nonce store) — the caller must refuse, never fall back to the cookie flow.
 */
export async function issueOAuthState(
  admin: SupabaseClient,
  input: { userId: string; orgId: string; returnHost: string },
  now = Date.now()
): Promise<{ state: string; nonce: string } | null> {
  const key = subKey('state-mac')
  if (!key) return null
  const payload: OAuthStatePayload = {
    v: VERSION,
    u: input.userId,
    o: input.orgId,
    h: hostnameFromHeader(input.returnHost),
    n: randomUUID(),
    e: now + OAUTH_STATE_TTL_MS,
  }
  // Housekeeping: expired tickets are useless; drop them (best effort, never blocks a connect).
  try {
    await admin.from('oauth_states').delete().lt('expires_at', new Date(now).toISOString())
  } catch (e) {
    console.error('oauth-state: prune failed', e instanceof Error ? e.message : e)
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
  return { state: `${body}.${sign(body, key)}`, nonce: payload.n }
}

type Refusal = 'bad_signature' | 'expired' | 'used' | 'wrong_user' | 'wrong_host' | 'unavailable'

export type OAuthCallbackCheck =
  | { ok: true; nonce: string; userId: string; orgId: string; returnOrigin: string }
  | { ok: false; reason: Refusal }

async function verifyState(admin: SupabaseClient, state: string, now: number): Promise<OAuthCallbackCheck> {
  const key = subKey('state-mac')
  if (!key) return { ok: false, reason: 'unavailable' }
  const [body, mac, extra] = state.split('.')
  if (!body || !mac || extra !== undefined || !safeEqual(sign(body, key), mac)) return { ok: false, reason: 'bad_signature' }

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

  const { data: user, error: userError } = await admin.from('users').select('id, org_id, active').eq('id', p.u).maybeSingle()
  if (userError) return { ok: false, reason: 'unavailable' }
  if (!user || user.org_id !== p.o || user.active === false) return { ok: false, reason: 'wrong_user' }

  // The return host must be that org's own address — never a host taken from the request.
  const { data: org, error: orgError } = await admin.from('orgs').select('subdomain').eq('id', p.o).maybeSingle()
  if (orgError) return { ok: false, reason: 'unavailable' }
  const origin = companyAppUrl((org as { subdomain?: string | null } | null)?.subdomain ?? null, appBaseDomain())
  if (!origin || new URL(origin).hostname !== p.h) return { ok: false, reason: 'wrong_host' }

  return { ok: true, nonce: p.n, userId: p.u, orgId: p.o, returnOrigin: origin }
}

/**
 * Step 2 (fixed redirect host). Verify the ticket and park Google's one-time code on its row (once). With no code
 * (consent denied) the row is discarded. Never reads a cookie; never stores a connection.
 */
export async function acceptOAuthCallback(
  admin: SupabaseClient,
  state: string,
  code: string | null,
  now = Date.now()
): Promise<OAuthCallbackCheck> {
  const check = await verifyState(admin, state, now)
  if (!check.ok) return check
  const nowIso = new Date(now).toISOString()
  const sealed = code ? sealCode(code) : null
  if (code && !sealed) return { ok: false, reason: 'unavailable' }
  const patch = sealed ? { code_ciphertext: sealed, code_received_at: nowIso } : { used_at: nowIso }
  const { data, error } = await admin
    .from('oauth_states')
    .update(patch)
    .eq('nonce', check.nonce)
    .eq('user_id', check.userId)
    .eq('org_id', check.orgId)
    .is('used_at', null)
    .is('code_ciphertext', null)
    .gt('expires_at', nowIso)
    .select('nonce')
  if (error) return { ok: false, reason: 'unavailable' }
  if (!data || data.length !== 1) return { ok: false, reason: 'used' }
  return check
}

export type OAuthFinish =
  | { ok: true; code: string }
  | { ok: false; reason: 'no_cookie' | 'used' | 'wrong_user' | 'unavailable' }

/**
 * Step 3 (company address, signed in). Consumes the row exactly once; returns the code only to the browser that
 * started the connect (nonce cookie) and only for the ticket's own user + org. Any refusal discards the row.
 */
export async function finishOAuthConnect(
  admin: SupabaseClient,
  input: { nonce: string | null; cookieNonce: string | null | undefined; userId: string; orgId: string },
  now = Date.now()
): Promise<OAuthFinish> {
  const nonce = input.nonce ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(nonce)) return { ok: false, reason: 'used' }
  const nowIso = new Date(now).toISOString()
  // Consume first (one winner), decide after: a refused finish still burns the ticket.
  const { data, error } = await admin
    .from('oauth_states')
    .update({ used_at: nowIso })
    .eq('nonce', nonce)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('user_id, org_id, code_ciphertext')
  if (error) return { ok: false, reason: 'unavailable' }
  const row = (data as Array<{ user_id: string; org_id: string; code_ciphertext: string | null }> | null)?.[0]
  if (!row || !row.code_ciphertext) return { ok: false, reason: 'used' }
  if (!input.cookieNonce || !safeEqual(input.cookieNonce, nonce)) return { ok: false, reason: 'no_cookie' }
  if (row.user_id !== input.userId || row.org_id !== input.orgId) return { ok: false, reason: 'wrong_user' }
  const code = openCode(row.code_ciphertext)
  if (!code) return { ok: false, reason: 'unavailable' }
  // The code is spent either way; don't leave it at rest.
  await admin.from('oauth_states').update({ code_ciphertext: null }).eq('nonce', nonce)
  return { ok: true, code }
}
