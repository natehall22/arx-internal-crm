import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import { SUPPORT_COOKIE } from '@/lib/support/token'

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

  const store = cookies()
  // Support access: the signed-in JWT is the STAFF member's own (their company), not the company being supported.
  // A user-token client would read and write the wrong company, so none is handed out during a support session.
  if (store.get(SUPPORT_COOKIE)?.value) return null
  const session = getSupabaseSessionFromCookieStore(store)
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
