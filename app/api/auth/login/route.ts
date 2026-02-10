import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/login', req.url), { status: 302 })
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables')
    return NextResponse.redirect(new URL('/login?error=Server+configuration+error', request.url), { status: 303 })
  }

  const form = await request.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const rawNext = String(form.get('next') ?? '/dashboard')
  const nextPath = rawNext.startsWith('/') ? rawNext : '/dashboard'

  // We need to collect cookies during auth, then apply them to the final response
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

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    console.error('Auth error:', error.message)
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url),
      { status: 303 }
    )
  }

  // Success - create redirect response and apply all cookies
  const response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 })
  
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, {
      ...options,
      // Ensure cookies work in production
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })
  })

  return response
}
