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
      sessionData = JSON.parse(singleCookie.value)
    } catch {
      // Failed to parse
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
      try {
        sessionData = JSON.parse(chunks.join(''))
      } catch {
        // Failed to parse
      }
    }
  }

  return sessionData
}

export async function requireAuth(): Promise<AuthContext> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const sessionData = getSessionFromCookies()

  if (!sessionData?.access_token) {
    console.log('requireAuth: No session cookie found')
    redirect('/login')
  }

  // Verify the token and get user using anon key
  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(sessionData.access_token)

  if (authError || !user) {
    console.log('requireAuth: Token invalid or expired', authError?.message)
    redirect('/login')
  }

  console.log('requireAuth: User verified:', user.id, user.email)

  // ALWAYS use service role to bypass RLS for profile fetch
  if (!serviceRoleKey) {
    console.error('requireAuth: SUPABASE_SERVICE_ROLE_KEY is not set!')
    redirect('/login?error=server_config')
  }

  const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  // First, let's see ALL users to debug
  const { data: allUsers, error: allError } = await adminClient
    .from('users')
    .select('id, email')
    .limit(10)

  console.log('requireAuth: All users query:', { count: allUsers?.length, error: allError?.message, users: allUsers })

  // Now query for this specific user
  const { data: profiles, error: profileError } = await adminClient
    .from('users')
    .select('*')
    .eq('id', user.id)

  console.log('requireAuth: Profile query (no single):', { 
    count: profiles?.length, 
    error: profileError?.message,
    searchId: user.id 
  })

  const profile = profiles?.[0]

  if (profileError || !profile) {
    console.error('User profile missing for auth user:', user.id, profileError)
    redirect('/login?error=profile_missing')
  }

  return {
    authUser: { id: user.id, email: user.email ?? null },
    profile: profile as User,
  }
}
