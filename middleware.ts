import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

  // Get project ref for cookie name
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  // Try to get the auth cookie (might be single or chunked)
  let sessionData: any = null
  
  const singleCookie = request.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      sessionData = JSON.parse(singleCookie.value)
      console.log('MIDDLEWARE: Found single auth cookie')
    } catch {
      console.log('MIDDLEWARE: Failed to parse single cookie')
    }
  }

  // Try chunked cookies if single didn't work
  if (!sessionData) {
    const chunks: string[] = []
    let i = 0
    while (true) {
      const chunk = request.cookies.get(`${cookieName}.${i}`)
      if (!chunk?.value) break
      chunks.push(chunk.value)
      i++
    }
    if (chunks.length > 0) {
      try {
        sessionData = JSON.parse(chunks.join(''))
        console.log('MIDDLEWARE: Found', chunks.length, 'chunked auth cookies')
      } catch {
        console.log('MIDDLEWARE: Failed to parse chunked cookies')
      }
    }
  }

  if (!sessionData?.access_token) {
    console.log('MIDDLEWARE:', pathname, '- No valid session cookie found')
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Verify the token with Supabase
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${sessionData.access_token}`,
      },
    },
  })

  const { data: { user }, error } = await supabase.auth.getUser(sessionData.access_token)

  console.log('MIDDLEWARE:', pathname, '- user:', user?.email || 'none', '- error:', error?.message || 'none')

  if (error || !user) {
    // Token invalid or expired - redirect to login
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    console.log('MIDDLEWARE: Token invalid, redirecting to login')
    return NextResponse.redirect(loginUrl)
  }

  // User is authenticated
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
