import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import type { User } from '@/lib/types/database'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import { COMPANY_LOOKUP_UNAVAILABLE, deploymentOrgId, fenceAllowsOrg } from '@/lib/company-host'
import { getRequestCompanyFence } from '@/lib/company-host-server'
import { checkSupportSession, logSupportEvent, type SupportMarker } from '@/lib/support/access'
import { SAFE_METHODS, SUPPORT_REQUEST_HEADER, supportCookieFrom, supportRequestRefusal, verifySupportToken } from '@/lib/support/token'

export type AuthContext = {
  authUser: {
    id: string
    email: string | null
  }
  profile: User
  /**
   * Present ONLY inside a support session (lib/support/access.ts): `profile` is then the acting-as user's and `support`
   * says who is really behind it. Set by `resolveSupport` below and nowhere else.
   */
  support?: SupportMarker
}

type AuthResolution =
  | { status: 'ok'; context: AuthContext }
  | { status: 'no_session' }
  | { status: 'invalid_token' }
  | { status: 'no_profile' }
  | { status: 'inactive' }
  | { status: 'config_error' }
  | { status: 'company_unavailable' }

function getSessionFromCookies() {
  return getSupabaseSessionFromCookieStore(cookies())
}

// Extracts the access token from either the Authorization header (iOS/native)
// or the Supabase session cookie (web). Cookie auth is the fallback so existing
// web sessions are unaffected.
function getAccessToken(): string | null {
  try {
    const authHeader = headers().get('authorization') ?? headers().get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7)
    }
  } catch {
    // headers() can throw outside of a request context (e.g. in tests)
  }
  return getSessionFromCookies()?.access_token ?? null
}

/**
 * Per-copy fence (env only). Each company's copy of the CRM sets env DEPLOYMENT_ORG_ID to its own org id.
 * Unset (or blank) = no fence. Used where there is no request host to consult (e.g. the leads webhook's
 * token check). resolveAuth uses the full company fence (`lib/company-host.ts`: DEPLOYMENT_ORG_ID, then the
 * company web address, then the iPhone company code), which includes this rule.
 */
export function profileAllowedOnThisDeployment(orgId: string | null | undefined): boolean {
  const pinned = deploymentOrgId()
  if (!pinned) return true
  return orgId === pinned
}

/**
 * Support session (lib/support/access.ts): the signed cookie + a fresh database check of the staff row, the company's live
 * grant (or always-on) and the acting-as user. The ONLY way another company's profile can come out of resolveAuth for someone who
 * is not that company's own user. Anything short of a fully valid session (no cookie, forged, expired, grant ended, staff
 * removed) returns null and the ordinary path runs — a support cookie never widens anything by being present.
 * The company fence applies to the ACTING profile's company, so a company's copy or address admits support only into itself.
 */
async function resolveSupport(): Promise<AuthResolution | null> {
  let cookieValue: string | null
  try {
    // The iPhone app and other Bearer callers authenticate their own token only: a support cookie never applies to them.
    const authHeader = headers().get('authorization') ?? ''
    if (/^bearer\s/i.test(authHeader)) return null
    cookieValue = supportCookieFrom(cookies())
  } catch {
    return null
  }
  if (!cookieValue) return null
  const payload = await verifySupportToken(cookieValue, 'session')
  if (!payload) return null
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return null
  const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const checked = await checkSupportSession(admin, payload)
  if (checked.status !== 'ok') {
    console.error('requireAuth: support session refused', checked.reason)
    return null
  }
  const fence = await getRequestCompanyFence()
  if (fence.kind === 'closed' && fence.reason === 'lookup_error') return { status: 'company_unavailable' }
  if (!fenceAllowsOrg(fence, checked.profile.org_id)) {
    console.error('requireAuth: support session not allowed on this company address')
    return null
  }
  return {
    status: 'ok',
    context: { authUser: { id: checked.profile.id, email: checked.profile.email ?? null }, profile: checked.profile, support: checked.support },
  }
}

async function resolveAuth(opts: { ignoreSupport?: boolean } = {}): Promise<AuthResolution> {
  if (!opts.ignoreSupport) {
    const support = await resolveSupport()
    if (support) {
      // Every caller (requireAuth in a server action, getAuthContext, requireAuthApi) gets the same write rule.
      if (support.status === 'ok' && support.context.support) await enforceSupportWrites(support.context.support)
      return support
    }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const accessToken = getAccessToken()

  if (!accessToken) {
    console.log('requireAuth: No session cookie found')
    return { status: 'no_session' }
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken)

  if (authError || !user) {
    console.log('requireAuth: Token invalid or expired', authError?.message)
    return { status: 'invalid_token' }
  }

  if (!serviceRoleKey) {
    console.error('requireAuth: SUPABASE_SERVICE_ROLE_KEY is not set!')
    return { status: 'config_error' }
  }

  const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: profiles, error: profileError } = await adminClient
    .from('users')
    .select('*')
    .eq('id', user.id)

  const profile = profiles?.[0]

  if (profileError || !profile) {
    console.error('User profile missing for auth user:', user.id, profileError)
    return { status: 'no_profile' }
  }

  const row = profile as User
  // Company fence: DEPLOYMENT_ORG_ID > the company web address > the iPhone company code (lib/company-host.ts).
  // A profile from any other company — or any request on an unknown company address — is treated as no profile.
  const fence = await getRequestCompanyFence()
  if (fence.kind === 'closed' && fence.reason === 'lookup_error') {
    // Not "signed out": the company lookup failed. Surfaced as 503 so clients keep the session and retry.
    console.error('requireAuth: company lookup unavailable', user.id)
    return { status: 'company_unavailable' }
  }
  if (!fenceAllowsOrg(fence, row.org_id)) {
    console.error('requireAuth: user not allowed on this company address', user.id, fence.kind === 'closed' ? fence.reason : 'other_org')
    return { status: 'no_profile' }
  }
  if (row.active === false) {
    console.log('requireAuth: user disabled in users.active', user.id)
    return { status: 'inactive' }
  }

  return {
    status: 'ok',
    context: {
      authUser: { id: user.id, email: user.email ?? null },
      profile: row,
    },
  }
}

/**
 * Thrown by requireAuth / requireAuthApi when the company behind the web address could not be looked up. Not an
 * auth failure: API callers should answer 503 + `code: 'company_lookup_unavailable'` (middleware already does so
 * for /api on company addresses before the route runs), never 401.
 */
export class CompanyLookupUnavailableError extends Error {
  readonly code = COMPANY_LOOKUP_UNAVAILABLE
  constructor() {
    super('Service unavailable')
    this.name = 'CompanyLookupUnavailableError'
  }
}

/**
 * Optional auth for layouts — returns null if not signed in or disabled.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const r = await resolveAuth()
  return r.status === 'ok' ? r.context : null
}

/**
 * The person's OWN signed-in identity, support session ignored (a support cookie is never consulted). Only for the staff side
 * (`/support`, lib/support/staff.ts): "who am I really", not "who am I acting as".
 */
export async function getRealAuthContext(): Promise<AuthContext | null> {
  const r = await resolveAuth({ ignoreSupport: true })
  return r.status === 'ok' ? r.context : null
}

/**
 * Use in Server Components and pages - redirects to login on failure
 */
export async function requireAuth(): Promise<AuthContext> {
  const r = await resolveAuth()
  if (r.status === 'ok') return r.context
  if (r.status === 'company_unavailable') throw new CompanyLookupUnavailableError()
  if (r.status === 'inactive') {
    redirect('/login?inactive=1')
  }
  redirect('/login')
}

/**
 * Use in API routes - throws error instead of redirecting
 * Catch the error and return appropriate JSON response
 */
export async function requireAuthApi(): Promise<AuthContext> {
  const r = await resolveAuth()
  if (r.status === 'ok') return r.context
  if (r.status === 'company_unavailable') throw new CompanyLookupUnavailableError()
  if (r.status === 'inactive') {
    throw new Error('Account disabled')
  }
  throw new Error('Unauthorized')
}

/**
 * Thrown by requireAuthApi when a support session may not make this write. Middleware already answers 403 "Support view mode"
 * before the route runs; this is the backstop (a route's own catch-all may turn it into a 401, which is still a refusal).
 */
export class SupportWriteRefusedError extends Error {
  readonly status = 403
  constructor(message: string) {
    super(message)
    this.name = 'SupportWriteRefusedError'
  }
}

/** One 'write' log row per request, however many times auth is resolved in it (keyed on the request's headers object). */
const loggedWrites = new WeakMap<object, Promise<void>>()

/**
 * View mode: every write is refused. Full mode: each write is logged first and refused if it cannot be logged; credential and
 * support-settings doors are refused in every mode (`supportRequestRefusal`, lib/support/token.ts — the same rule middleware
 * applies). The method and path come from middleware's header (never from the client: middleware deletes any copy and sets its
 * own); a missing or unreadable header inside a support session is treated as a write (fail closed).
 */
async function enforceSupportWrites(support: SupportMarker): Promise<void> {
  let raw = ''
  let reqKey: object | null = null
  try {
    const h = headers()
    reqKey = h as unknown as object
    raw = h.get(SUPPORT_REQUEST_HEADER) ?? ''
  } catch {
    raw = ''
  }
  const space = raw.indexOf(' ')
  const method = space > 0 ? raw.slice(0, space).toUpperCase() : ''
  const path = space > 0 ? raw.slice(space + 1) : ''
  const refusal = supportRequestRefusal(method, path, support.level)
  if (refusal) throw new SupportWriteRefusedError(refusal)
  if (method && SAFE_METHODS.has(method)) return
  const pending = reqKey ? loggedWrites.get(reqKey) : undefined
  if (pending) return pending
  const write = (async () => {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) throw new SupportWriteRefusedError('Support write could not be recorded')
    const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    try {
      await logSupportEvent(admin, { orgId: support.orgId, staffUserId: support.staffUserId, actingAsUserId: support.actingAsUserId, level: 'full', event: 'write', detail: { method: method || 'unknown', route: path || 'unknown' } })
    } catch (e) {
      console.error('[support] write refused: could not record it', e)
      throw new SupportWriteRefusedError('Support write could not be recorded')
    }
  })()
  if (reqKey) loggedWrites.set(reqKey, write)
  return write
}
