export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/login', req.url), { status: 302 })
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables')
    return NextResponse.redirect(
      new URL('/login?error=Server+configuration+error', request.url),
      { status: 303 }
    )
  }

  const formData = await request.formData()
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const rawNext = String(formData.get('next') ?? '/dashboard')
  const nextPath = rawNext.startsWith('/') ? rawNext : '/dashboard'

  // Collect cookies that Supabase wants to set
  const cookiesToSet: Array<{ name: string; value: string; options?: any }> = []

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookies: Array<{ name: string; value: string; options?: any }>) {
        cookies.forEach((cookie) => cookiesToSet.push(cookie))
      },
    },
  })

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.session) {
    console.error('Auth error:', error?.message || 'No session returned')
    const errorUrl = new URL('/login', request.url)
    errorUrl.searchParams.set('error', error?.message || 'Authentication failed')
    errorUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(errorUrl, { status: 303 })
  }

  // Success - create redirect and apply cookies
  const successUrl = new URL(nextPath, request.url)
  const response = NextResponse.redirect(successUrl, { status: 303 })

  // Apply all cookies from Supabase auth
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, {
      ...options,
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
  }

  return response
}
