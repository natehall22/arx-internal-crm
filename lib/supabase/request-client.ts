import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'

/** Bearer header first, then session cookie — matches requireAuthApi token sources. */
export function getRequestAccessToken(): string | null {
  try {
    const authHeader = headers().get('authorization') ?? headers().get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim()
      if (token) return token
    }
  } catch {
    // headers() throws outside a request context (tests)
  }

  const session = getSupabaseSessionFromCookieStore(cookies())
  return session?.access_token ?? null
}

/** Supabase client scoped to the current user's JWT (RLS applies; works for web + Bearer). */
export function createRequestScopedClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  return createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}
