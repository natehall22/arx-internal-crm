import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip middleware entirely for API routes - they handle their own auth
  // This prevents any chance of returning HTML to API calls
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Public paths - no auth required
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/trial' ||
    pathname === '/reset-password' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/contracts/') ||
    pathname.startsWith('/change-orders/sign/') ||
    pathname.startsWith('/sub-portal/') ||
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

  if (!supabaseUrl) {
    return NextResponse.next()
  }

  // Get project ref for cookie name
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  // Try to get the auth cookie (might be single or chunked)
  let sessionData: { access_token?: string; expires_at?: number } | null = null
  
  const singleCookie = request.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      sessionData = JSON.parse(singleCookie.value)
    } catch {
      // Failed to parse
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
      } catch {
        // Failed to parse
      }
    }
  }

  // If no session cookie found, redirect to login
  if (!sessionData?.access_token) {
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Check if token is expired based on exp claim
  if (sessionData.expires_at) {
    const expiresAt = sessionData.expires_at * 1000 // Convert to ms
    if (Date.now() > expiresAt) {
      const loginUrl = new URL(request.url)
      loginUrl.pathname = '/login'
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // User has a session cookie - let them through
  return NextResponse.next()
}

export const config = {
  // Exclude API routes and static files from middleware entirely
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
