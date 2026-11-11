/**
 * The OAuth state: one-time codes and grants (a grant = "this person connected this app"). Only HASHES of codes and keys
 * are stored. Rotation + reuse detection live here, and only here.
 *
 * Refresh keys rotate on every use. The old key is kept as "retired"; showing a retired key again means a copy leaked, so
 * the whole grant is revoked (RFC 9700 §4.14). Two refreshes racing with the same key: one wins, the other is refused
 * and revokes the grant — an honest client that retries after a network failure just signs in again.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { ACCESS_PREFIX, ACCESS_TTL_SECONDS, CODE_PREFIX, CODE_TTL_SECONDS, GRANT_MAX_LIFETIME_SECONDS, REFRESH_PREFIX, REFRESH_TTL_SECONDS } from '@/lib/ai-connector/config'
import { appLabelForRedirect } from '@/lib/ai-connector/clients'
import { randomToken, sha256Hex, verifyPkce } from '@/lib/ai-connector/crypto'
import { orgDb } from '@/lib/supabase/org-db'

export type Grant = {
  id: string
  org_id: string
  user_id: string
  client_id: string
  scopes: string[]
  resource: string
  code_hash: string | null
  access_hash: string
  access_expires_at: string
  refresh_hash: string
  refresh_expires_at: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  revoked_reason: string | null
}

export type TokenSet = { access_token: string; refresh_token: string; expires_in: number; scope: string; token_type: 'Bearer' }

const iso = (ms: number) => new Date(ms).toISOString()
const GRANT_COLS = 'id, org_id, user_id, client_id, scopes, resource, code_hash, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at, last_used_at, revoked_at, revoked_reason'

export async function createAuthCode(
  admin: SupabaseClient,
  input: { clientId: string; orgId: string; userId: string; redirectUri: string; codeChallenge: string; resource: string; scopes: string[] },
  now = Date.now()
): Promise<string> {
  const code = randomToken(CODE_PREFIX)
  const { error } = await orgDb(admin, input.orgId).from('ai_oauth_codes').insert({
    code_hash: sha256Hex(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    resource: input.resource,
    scopes: input.scopes,
    expires_at: iso(now + CODE_TTL_SECONDS * 1000),
  })
  if (error) throw new Error(`create code: ${error.message}`)
  return code
}

export type OAuthFailure = { error: 'invalid_grant' | 'invalid_request' | 'invalid_target'; description: string; /** who the refused key belonged to, when we know (for the audit log) */ audit?: { orgId: string; userId: string; clientId: string } }

/** A connection ends GRANT_MAX_LIFETIME_SECONDS after the person approved it (created_at), however often it refreshes. */
export const grantAbsoluteExpiryMs = (g: { created_at: string }) => new Date(g.created_at).getTime() + GRANT_MAX_LIFETIME_SECONDS * 1000

function mintTokens(scopes: string[], now: number, endsAt = Infinity) {
  const access = randomToken(ACCESS_PREFIX)
  const refresh = randomToken(REFRESH_PREFIX)
  return {
    access,
    refresh,
    row: {
      access_hash: sha256Hex(access),
      access_expires_at: iso(Math.min(now + ACCESS_TTL_SECONDS * 1000, endsAt)),
      refresh_hash: sha256Hex(refresh),
      refresh_expires_at: iso(Math.min(now + REFRESH_TTL_SECONDS * 1000, endsAt)),
    },
    set: { access_token: access, refresh_token: refresh, expires_in: Math.max(1, Math.floor((Math.min(now + ACCESS_TTL_SECONDS * 1000, endsAt) - now) / 1000)), scope: scopes.join(' '), token_type: 'Bearer' as const },
  }
}

/** Spend a code: exactly one caller wins. A code shown twice revokes the grant it already made. */
export async function exchangeCode(
  admin: SupabaseClient,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: unknown; resource: string | null },
  now = Date.now()
): Promise<{ ok: true; tokens: TokenSet; grant: { id: string; orgId: string; userId: string } } | ({ ok: false } & OAuthFailure)> {
  const codeHash = sha256Hex(input.code)
  // org-scope-ok: the code is a one-time secret that names its own company; org_id is read from the row it spends
  const { data: spent } = await admin.from('ai_oauth_codes').update({ used_at: iso(now) }).eq('code_hash', codeHash).is('used_at', null).select('code_hash, client_id, org_id, user_id, redirect_uri, code_challenge, resource, scopes, expires_at')
  const row = (spent as Array<{ client_id: string; org_id: string; user_id: string; redirect_uri: string; code_challenge: string; resource: string; scopes: string[]; expires_at: string }> | null)?.[0]
  if (!row) {
    // Unknown, or already used: if it was used, take back what it made.
    // org-scope-ok: lookup by the secret code hash; the revoke below is scoped to the grant's own company
    const { data: grants } = await admin.from('ai_oauth_grants').select('id, org_id, user_id, client_id').eq('code_hash', codeHash)
    const made = (grants ?? []) as Array<{ id: string; org_id: string; user_id: string; client_id: string }>
    for (const g of made) await revokeGrant(admin, g.org_id, g.id, 'code_reuse', now)
    return { ok: false, error: 'invalid_grant', description: 'This code is not valid', audit: made[0] ? { orgId: made[0].org_id, userId: made[0].user_id, clientId: made[0].client_id } : undefined }
  }
  if (new Date(row.expires_at).getTime() < now) return { ok: false, error: 'invalid_grant', description: 'This code has expired' }
  if (row.client_id !== input.clientId) return { ok: false, error: 'invalid_grant', description: 'This code was issued to another app' }
  if (row.redirect_uri !== input.redirectUri) return { ok: false, error: 'invalid_grant', description: 'redirect_uri does not match' }
  if (!verifyPkce(input.codeVerifier, row.code_challenge)) return { ok: false, error: 'invalid_grant', description: 'code_verifier does not match' }
  // Audience binding: a token request may only ask for the resource the code was issued for.
  if (input.resource !== null && input.resource !== row.resource) return { ok: false, error: 'invalid_target', description: 'resource does not match the sign-in request' }

  const t = mintTokens(row.scopes, now)
  const { data: made, error } = await orgDb(admin, row.org_id)
    .from('ai_oauth_grants')
    .insert({ user_id: row.user_id, client_id: row.client_id, scopes: row.scopes, resource: row.resource, code_hash: codeHash, created_at: iso(now), ...t.row })
    .select('id')
    .single()
  if (error || !made) throw new Error(`create grant: ${error?.message ?? 'no row'}`)
  return { ok: true, tokens: t.set, grant: { id: (made as { id: string }).id, orgId: row.org_id, userId: row.user_id } }
}

/** Trade a refresh key for a new pair. Retired key = leaked copy = grant revoked. */
export async function refreshTokens(
  admin: SupabaseClient,
  input: { refreshToken: string; clientId: string; resource: string | null },
  now = Date.now()
): Promise<{ ok: true; tokens: TokenSet; grant: { id: string; orgId: string; userId: string } } | ({ ok: false } & OAuthFailure)> {
  const hash = sha256Hex(input.refreshToken)
  // org-scope-ok: lookup by the secret refresh key hash; everything after is scoped to the grant's own company
  const { data } = await admin.from('ai_oauth_grants').select(GRANT_COLS).eq('refresh_hash', hash).maybeSingle()
  const grant = data as Grant | null
  if (!grant) {
    // org-scope-ok: lookup by the secret (retired) refresh key hash; revoke below is scoped to the grant's company
    const { data: old } = await admin.from('ai_oauth_retired_refresh').select('grant_id').eq('refresh_hash', hash).maybeSingle()
    const gid = (old as { grant_id?: string } | null)?.grant_id
    if (gid) {
      // org-scope-ok: grant id came from the retired-key row above; org read from the grant itself
      const { data: g } = await admin.from('ai_oauth_grants').select('id, org_id, user_id, client_id').eq('id', gid).maybeSingle()
      const gg = g as { org_id: string; user_id: string; client_id: string } | null
      if (gg) {
        await revokeGrant(admin, gg.org_id, gid, 'refresh_reuse', now)
        return { ok: false, error: 'invalid_grant', description: 'This refresh token is not valid', audit: { orgId: gg.org_id, userId: gg.user_id, clientId: gg.client_id } }
      }
    }
    return { ok: false, error: 'invalid_grant', description: 'This refresh token is not valid' }
  }
  const who = { orgId: grant.org_id, userId: grant.user_id, clientId: grant.client_id }
  if (grant.client_id !== input.clientId) return { ok: false, error: 'invalid_grant', description: 'This token was issued to another app', audit: who }
  if (grant.revoked_at || new Date(grant.refresh_expires_at).getTime() < now || grantAbsoluteExpiryMs(grant) <= now) return { ok: false, error: 'invalid_grant', description: 'This token is no longer valid', audit: who }
  if (input.resource !== null && input.resource !== grant.resource) return { ok: false, error: 'invalid_target', description: 'resource does not match the original sign-in' }

  const t = mintTokens(grant.scopes, now, grantAbsoluteExpiryMs(grant))
  // The old key must still be the current one: of two racing refreshes only one updates a row.
  const { data: rotated } = await orgDb(admin, grant.org_id)
    .from('ai_oauth_grants')
    .update({ ...t.row, last_used_at: iso(now) })
    .eq('id', grant.id)
    .eq('refresh_hash', hash)
    .is('revoked_at', null)
    .select('id')
  if (!rotated || (rotated as unknown[]).length === 0) {
    await revokeGrant(admin, grant.org_id, grant.id, 'refresh_reuse', now)
    return { ok: false, error: 'invalid_grant', description: 'This refresh token was already used', audit: who }
  }
  // org-scope-ok: retired-key row hangs off a grant just updated company-scoped above (no org_id column on this table)
  await admin.from('ai_oauth_retired_refresh').insert({ refresh_hash: hash, grant_id: grant.id, retired_at: iso(now) })
  return { ok: true, tokens: t.set, grant: { id: grant.id, orgId: grant.org_id, userId: grant.user_id } }
}

export async function revokeGrant(admin: SupabaseClient, orgId: string, grantId: string, reason: string, now = Date.now(), onlyUserId?: string): Promise<boolean> {
  let q = orgDb(admin, orgId).from('ai_oauth_grants').update({ revoked_at: iso(now), revoked_reason: reason }).eq('id', grantId).is('revoked_at', null)
  if (onlyUserId) q = q.eq('user_id', onlyUserId)
  const { data } = await q.select('id')
  return Array.isArray(data) && data.length > 0
}

/** Revoke by key (RFC 7009). Only the app the key was issued to may ask; an unknown key is a quiet success. */
export async function revokeByToken(admin: SupabaseClient, token: string, clientId: string, now = Date.now()): Promise<void> {
  const hash = sha256Hex(token)
  // org-scope-ok: lookup by the secret key hash; revoke is scoped to the grant's own company
  const { data } = await admin.from('ai_oauth_grants').select('id, org_id, client_id, access_hash, refresh_hash').or(`access_hash.eq.${hash},refresh_hash.eq.${hash}`).maybeSingle()
  const g = data as { id: string; org_id: string; client_id: string } | null
  if (g && g.client_id === clientId) await revokeGrant(admin, g.org_id, g.id, 'app_revoked', now)
}

export async function revokeAllForUser(admin: SupabaseClient, orgId: string, userId: string, reason: string, now = Date.now()): Promise<number> {
  const { data } = await orgDb(admin, orgId).from('ai_oauth_grants').update({ revoked_at: iso(now), revoked_reason: reason }).eq('user_id', userId).is('revoked_at', null).select('id')
  return Array.isArray(data) ? data.length : 0
}

export async function findGrantByAccessToken(admin: SupabaseClient, token: string): Promise<Grant | null> {
  // org-scope-ok: the access key is a secret that names its own grant and company; the caller checks the company against the request address
  const { data } = await admin.from('ai_oauth_grants').select(GRANT_COLS).eq('access_hash', sha256Hex(token)).maybeSingle()
  return (data as Grant | null) ?? null
}

export async function touchGrant(admin: SupabaseClient, orgId: string, grantId: string, now = Date.now()): Promise<void> {
  await orgDb(admin, orgId).from('ai_oauth_grants').update({ last_used_at: iso(now) }).eq('id', grantId)
}

export type GrantView = { id: string; user_id: string; client_id: string; client_name: string | null; app_label: string | null; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }

/** Live connections of a company (owner screen) or of one person (their own list). */
export async function listGrants(admin: SupabaseClient, orgId: string, opts: { userId?: string } = {}): Promise<GrantView[]> {
  let q = orgDb(admin, orgId).from('ai_oauth_grants').select('id, user_id, client_id, scopes, created_at, last_used_at, revoked_at, refresh_expires_at').is('revoked_at', null).gt('refresh_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(200)
  if (opts.userId) q = q.eq('user_id', opts.userId)
  const { data } = await q
  const rows = (data ?? []) as Array<{ id: string; user_id: string; client_id: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }>
  const ids = Array.from(new Set(rows.map((r) => r.client_id)))
  const names = new Map<string, { name: string | null; uris: string[] }>()
  if (ids.length) {
    const { data: cs } = await admin.from('ai_oauth_clients').select('client_id, client_name, redirect_uris').in('client_id', ids)
    for (const c of (cs ?? []) as Array<{ client_id: string; client_name: string | null; redirect_uris: string[] }>) names.set(c.client_id, { name: c.client_name, uris: c.redirect_uris })
  }
  return rows.map((r) => ({ ...r, client_name: names.get(r.client_id)?.name ?? null, app_label: appLabelForRedirect(names.get(r.client_id)?.uris ?? []) }))
}
