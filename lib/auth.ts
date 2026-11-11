import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import type { User } from '@/lib/types/database'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import { COMPANY_LOOKUP_UNAVAILABLE, deploymentOrgId, fenceAllowsOrg } from '@/lib/company-host'
import { getRequestCompanyFence } from '@/lib/company-host-server'

export type AuthContext = {
  authUser: {
    id: string
    email: string | null
  }
  profile: User
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

async function resolveAuth(): Promise<AuthResolution> {
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
