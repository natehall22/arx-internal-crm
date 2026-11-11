/**
 * The ONE door for the AI connector: a bearer key in, the SAME profile object `requireAuthApi` returns out (or a refusal).
 * Checks, in order: key exists and is live → issued for THIS address (audience) → this company address allows its
 * company (host fence; the iPhone company-code header is never consulted here) → the person is still an active user of
 * that company → the company's `aiConnector` switch is on → the key carries `crm:read`.
 * Every one of those is re-checked on EVERY request, so turning a person off, switching the connector off or revoking an
 * app stops it on the next call. Never reuses a Supabase session.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { AuthContext } from '@/lib/auth'
import { AI_CONNECTOR_FEATURE } from '@/lib/ai-connector/config'
import { writeAudit } from '@/lib/ai-connector/audit'
import type { RateGate } from '@/lib/ai-connector/rate-limit'
import { findGrantByAccessToken, grantAbsoluteExpiryMs, revokeGrant, touchGrant, type Grant } from '@/lib/ai-connector/store'
import { mcpResource, protectedResourceMetadataUrl, requestOrigin } from '@/lib/ai-connector/urls'
import { ACCESS_PREFIX } from '@/lib/ai-connector/config'
import { fenceAllowsOrg, type CompanyFence } from '@/lib/company-host'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import type { User } from '@/lib/types/database'

export type McpAuthResult =
  | { ok: true; context: AuthContext; grant: Grant }
  | { ok: false; status: 401 | 403 | 503; error: 'invalid_token' | 'insufficient_scope' | 'unavailable'; challenge: string }

export type McpAuthDeps = {
  admin: SupabaseClient
  fence: () => Promise<CompanyFence>
  featureOn?: (orgId: string) => Promise<boolean>
  now?: number
  /** When given, refused calls by a known connection are written to the audit log (a few a minute per connection). */
  rate?: RateGate
}

const TOUCH_EVERY_MS = 60_000

function bearer(request: Request): string | null {
  const h = request.headers.get('authorization')
  if (!h) return null
  const m = h.match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

function challengeFor(request: Request, error?: string): string {
  const base = `Bearer resource_metadata="${protectedResourceMetadataUrl(requestOrigin(request))}"`
  return error ? `${base}, error="${error}"` : base
}

export async function authenticateMcpRequest(request: Request, deps: McpAuthDeps): Promise<McpAuthResult> {
  const seen: { grant: Grant | null; reason: string } = { grant: null, reason: '' }
  const out = await authenticateCore(request, deps, seen)
  if (!out.ok && seen.grant) {
    const g = seen.grant
    const allowed = deps.rate ? (await deps.rate(`mcp:authfail:${g.id}`, 6, 60)).ok : true
    if (allowed) await writeAudit(deps.admin, { orgId: g.org_id, userId: g.user_id, clientId: g.client_id, tool: 'mcp.auth_refused', result: 'denied', detail: seen.reason }).catch(() => undefined)
  }
  return out
}

async function authenticateCore(request: Request, deps: McpAuthDeps, seen: { grant: Grant | null; reason: string }): Promise<McpAuthResult> {
  const now = deps.now ?? Date.now()
  const refuse = (status: 401 | 403 | 503, error: 'invalid_token' | 'insufficient_scope' | 'unavailable', withError = true): McpAuthResult => ({ ok: false, status, error, challenge: challengeFor(request, withError ? error : undefined) })

  const token = bearer(request)
  // No key at all: a plain challenge (no error code), so a client knows to start sign-in.
  if (!token) return { ok: false, status: 401, error: 'invalid_token', challenge: challengeFor(request) }
  if (!token.startsWith(ACCESS_PREFIX) || token.length > 200) return refuse(401, 'invalid_token')

  const grant = await findGrantByAccessToken(deps.admin, token)
  if (!grant) return refuse(401, 'invalid_token')
  seen.grant = grant
  const no = (reason: string, status: 401 | 403 | 503 = 401, error: 'invalid_token' | 'insufficient_scope' | 'unavailable' = 'invalid_token') => {
    seen.reason = reason
    return refuse(status, error, status !== 503)
  }
  if (grant.revoked_at) return no('revoked')
  if (new Date(grant.access_expires_at).getTime() <= now || grantAbsoluteExpiryMs(grant) <= now) return no('expired')
  // Audience: the key was issued for one MCP address; any other is refused.
  if (grant.resource !== mcpResource(requestOrigin(request))) return no('wrong_audience')

  const fence = await deps.fence()
  if (fence.kind === 'closed' && fence.reason === 'lookup_error') return refuse(503, 'unavailable', false)
  if (!fenceAllowsOrg(fence, grant.org_id)) return no('wrong_company_address')

  const { data: row } = await deps.admin.from('users').select('*').eq('id', grant.user_id).eq('org_id', grant.org_id).maybeSingle()
  const profile = row as User | null
  if (!profile || profile.active === false) {
    if (profile) await revokeGrant(deps.admin, grant.org_id, grant.id, 'user_inactive', now)
    return no('user_inactive')
  }
  const on = await (deps.featureOn ?? ((orgId: string) => isOrgFeatureOn(orgId, AI_CONNECTOR_FEATURE)))(grant.org_id)
  if (!on) return no('switch_off')
  if (!grant.scopes.includes('crm:read')) return no('scope', 403, 'insufficient_scope')

  if (!grant.last_used_at || now - new Date(grant.last_used_at).getTime() > TOUCH_EVERY_MS) await touchGrant(deps.admin, grant.org_id, grant.id, now).catch(() => undefined)
  return { ok: true, context: { authUser: { id: profile.id, email: (profile as { email?: string | null }).email ?? null }, profile }, grant }
}
