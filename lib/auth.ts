import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { User } from '@/lib/types/database'

export type AuthContext = {
  authUser: {
    id: string
    email: string | null
  }
  profile: User
}

export async function requireAuth(): Promise<AuthContext> {
  const supabase = createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    console.error('User profile missing for auth user:', user.id, profileError)
    redirect('/login?error=profile_missing')
  }

  return {
    authUser: { id: user.id, email: user.email ?? null },
    profile,
  }
}
