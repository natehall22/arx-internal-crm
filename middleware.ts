import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths - no auth required
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/contracts/') ||
    pathname.startsWith('/sub-portal/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.endsWith('.json') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.css')
  ) {
    return NextResponse.next()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.log('MIDDLEWARE: Missing Supabase env vars')
    return NextResponse.next()
  }

  // Log incoming cookies for debugging
  const incomingCookies = request.cookies.getAll()
  console.log('MIDDLEWARE:', pathname, '- cookies:', incomingCookies.map(c => c.name))

  // Create response FIRST - we will return THIS response with any cookie updates
  const response = NextResponse.next({
    request: { headers: request.headers },
  })

  // Create Supabase client with cookie adapter
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        console.log('MIDDLEWARE setAll:', cookiesToSet.map(c => c.name))
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // Get user - this may refresh the session and call setAll
  const { data: { user }, error } = await supabase.auth.getUser()

  console.log('MIDDLEWARE:', pathname, '- user:', user?.email || 'none', '- error:', error?.message || 'none')

  if (error || !user) {
    // Redirect to login preserving current host
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    console.log('MIDDLEWARE: Redirecting to login')
    return NextResponse.redirect(loginUrl)
  }

  // Return the response (with any refreshed cookies)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
