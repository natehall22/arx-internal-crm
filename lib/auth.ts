import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { User } from '@/lib/types/database'

export type AuthContext = {
  authUser: {
    id: string
    email: string | null
  }
  profile: User
}

function getSessionFromCookies() {
  const cookieStore = cookies()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  
  // Get project ref for cookie name
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  // Try to get the auth cookie (might be single or chunked)
  let sessionData: any = null
  
  const allCookies = cookieStore.getAll()
  const singleCookie = allCookies.find(c => c.name === cookieName)
  
  if (singleCookie?.value) {
    try {
      sessionData = JSON.parse(decodeURIComponent(singleCookie.value))
    } catch {
      try {
        sessionData = JSON.parse(singleCookie.value)
      } catch {
        // Failed to parse
      }
    }
  }

  // Try chunked cookies if single didn't work
  if (!sessionData) {
    const chunks: string[] = []
    let i = 0
    while (true) {
      const chunk = allCookies.find(c => c.name === `${cookieName}.${i}`)
      if (!chunk?.value) break
      chunks.push(chunk.value)
      i++
    }
    if (chunks.length > 0) {
      const joined = chunks.join('')
      try {
        sessionData = JSON.parse(decodeURIComponent(joined))
      } catch {
        try {
          sessionData = JSON.parse(joined)
        } catch {
          // Failed to parse
        }
      }
    }
  }

  return sessionData
}

async function getAuthContext(options?: { throwOnError?: boolean }): Promise<AuthContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const sessionData = getSessionFromCookies()

  if (!sessionData?.access_token) {
    console.log('requireAuth: No session cookie found')
    if (options?.throwOnError) throw new Error('No session')
    return null
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(sessionData.access_token)

  if (authError || !user) {
    console.log('requireAuth: Token invalid or expired', authError?.message)
    if (options?.throwOnError) throw new Error('Token invalid or expired')
    return null
  }

  if (!serviceRoleKey) {
    console.error('requireAuth: SUPABASE_SERVICE_ROLE_KEY is not set!')
    if (options?.throwOnError) throw new Error('Server config error')
    return null
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
    if (options?.throwOnError) throw new Error('Profile missing')
    return null
  }

  return {
    authUser: { id: user.id, email: user.email ?? null },
    profile: profile as User,
  }
}

/**
 * Use in Server Components and pages - redirects to login on failure
 */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext()
  if (!context) {
    redirect('/login')
  }
  return context
}

/**
 * Use in API routes - throws error instead of redirecting
 * Catch the error and return appropriate JSON response
 */
export async function requireAuthApi(): Promise<AuthContext> {
  const context = await getAuthContext({ throwOnError: true })
  if (!context) {
    throw new Error('Unauthorized')
  }
  return context
}
