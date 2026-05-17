import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import type { User } from '@/lib/types/database'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'

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
  if (r.status === 'inactive') {
    throw new Error('Account disabled')
  }
  throw new Error('Unauthorized')
}
