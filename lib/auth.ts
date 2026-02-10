import { redirect } from 'next/navigation'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getAccessTokenFromCookies } from '@/lib/supabase/server'
import type { User } from '@/lib/types/database'

export type AuthContext = {
  authUser: {
    id: string
    email: string | null
  }
  profile: User
}

export async function requireAuth(): Promise<AuthContext> {
  const accessToken = getAccessTokenFromCookies()
  if (!accessToken) {
    redirect('/login')
  }

  const authClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )

  const { data, error } = await authClient.auth.getUser(accessToken)

  if (error || !data?.user) {
    redirect('/login')
  }

  const dbClient = createClient()
  const { data: profile, error: profileError } = await dbClient
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .single()

  if (profileError || !profile) {
    console.error('User profile missing for auth user:', data.user.id, profileError)
    // Redirect to login instead of throwing - the user needs to be set up
    redirect('/login?error=profile_missing')
  }

  return {
    authUser: { id: data.user.id, email: data.user.email ?? null },
    profile,
  }
}