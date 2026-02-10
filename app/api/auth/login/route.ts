import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  // If someone lands here via GET, redirect to the login page
  return NextResponse.redirect(new URL('/login', req.url), { status: 302 })
}

export async function POST(request: NextRequest) {
  try {
    // All auth logic inside POST
    const { createServerClient } = await import('@supabase/ssr')
    
    const form = await request.formData()
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    const rawNext = String(form.get('next') ?? '/dashboard')
    const nextPath = rawNext.startsWith('/') ? rawNext : '/dashboard'
    const isProd = process.env.NODE_ENV === 'production'

    // Check env vars
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase environment variables')
      const url = new URL('/login', request.url)
      url.searchParams.set('error', 'Server configuration error')
      return NextResponse.redirect(url, { status: 303 })
    }

    // Create the redirect response FIRST so auth can set cookies on it
    let response = NextResponse.redirect(new URL(nextPath, request.url), { status: 303 })

    // Use cookies adapter on the response object being returned
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookieOptions: {
        secure: isProd,
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: Array<{ name: string; value: string; options?: any }>) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        }
      }
    })

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    
    if (error) {
      console.error('Auth error:', error.message)
      const url = new URL('/login', request.url)
      url.searchParams.set('error', error.message)
      return NextResponse.redirect(url, { status: 303 })
    }

    // Success - redirect to dashboard (or next path)
    return response
    
  } catch (err) {
    console.error('Login route error:', err)
    const url = new URL('/login', request.url)
    url.searchParams.set('error', 'An unexpected error occurred')
    return NextResponse.redirect(url, { status: 303 })
  }
}
