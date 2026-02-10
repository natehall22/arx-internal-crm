import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const email = String(formData.get('email') || '')
  const password = String(formData.get('password') || '')

  // Buffer cookies Supabase wants to set
  const pendingCookies: Array<{ name: string; value: string; options?: CookieOptions }> = []

  const isHttps = (() => {
    try {
      return new URL(request.url).protocol === 'https:'
    } catch {
      return false
    }
  })()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Patch cookie options for localhost/http dev
            const patched = {
              ...options,
              secure: isHttps ? (options?.secure ?? true) : false,
              sameSite: (options?.sameSite as 'lax' | 'strict' | 'none') ?? 'lax',
              path: options?.path ?? '/',
              httpOnly: options?.httpOnly ?? true,
            }
            pendingCookies.push({ name, value, options: patched })
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  const response = NextResponse.json({
    ok: !error && !!data?.session,
    error: error ? { message: error.message, name: error.name } : null,
    hasSession: !!data?.session,
    cookiesToSetCount: pendingCookies.length,
    user: data?.user ? { id: data.user.id, email: data.user.email } : null,
  })

  // FORCE set cookies on response - critical for session persistence
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}
