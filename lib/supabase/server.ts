import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'

export function createClient() {
  const cookieStore = cookies()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const sessionData = getSupabaseSessionFromCookieStore(cookieStore)

  // Create client with access token if available
  const client = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: sessionData?.access_token
      ? {
          headers: {
            Authorization: `Bearer ${sessionData.access_token}`,
          },
        }
      : undefined,
  })

  return client
}

export { createClient as createServerClient }
