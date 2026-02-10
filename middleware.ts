import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths - no auth required
  const publicPaths = [
    '/',
    '/login',
    '/favicon.ico',
  ]
  
  const publicPrefixes = [
    '/login/',
    '/contracts/',
    '/sub-portal/',
    '/api/',
    '/_next/',
  ]

  const publicExtensions = ['.json', '.js', '.png', '.ico', '.svg', '.css']

  const isPublic =
    publicPaths.includes(pathname) ||
    publicPrefixes.some((prefix) => pathname.startsWith(prefix)) ||
    publicExtensions.some((ext) => pathname.endsWith(ext))

  if (isPublic) {
    return NextResponse.next()
  }

  // Check env vars
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('Middleware: Missing Supabase env vars')
    return NextResponse.next()
  }

  // Create a response that we'll modify
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Create Supabase client with cookie handling
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        // Update request cookies for downstream
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
        // Create new response with updated cookies
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        })
        // Set cookies on response
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // Get user - this also refreshes the session if needed
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    // Not authenticated - redirect to login
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated - continue with possibly refreshed cookies
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
