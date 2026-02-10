import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

function getProjectRef() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  try {
    const host = new URL(supabaseUrl).hostname
    return host.split('.')[0] || ''
  } catch {
    return ''
  }
}

export function getAccessTokenFromCookies() {
  const cookieStore = cookies()
  const projectRef = getProjectRef()
  if (!projectRef) return null

  const cookie = cookieStore.get(`sb-${projectRef}-auth-token`)
  if (!cookie?.value) return null

  try {
    const parsed = JSON.parse(cookie.value)
    return typeof parsed?.access_token === 'string' ? parsed.access_token : null
  } catch {
    return null
  }
}

export function createClient() {
  const cookieStore = cookies()
  const isProd = process.env.NODE_ENV === 'production'
  const accessToken = getAccessTokenFromCookies()

  if (accessToken) {
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    )
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        secure: isProd,
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          // In Server Components, cookie writes may throw - that's expected
          // Cookies are persisted by middleware and route handlers
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Ignore - cookies will be set by middleware or route handlers
          }
        },
      },
    }
  )
}

// Alias for backwards compatibility
export { createClient as createServerClient }
