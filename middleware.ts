import { type NextRequest, NextResponse } from 'next/server'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import {
  isExpired,
  isExpiringSoon,
  refreshSupabaseSession,
  writeSessionCookies,
} from '@/lib/supabase/session-refresh'

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
    pathname.startsWith('/r/') || // public inspection-report share links (unguessable tokens)
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

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.next()
  }

  const sessionData = getSupabaseSessionFromCookieStore(request.cookies)

  // If no session cookie found, redirect to login
  if (!sessionData?.access_token) {
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // If the access token is expired or about to expire, silently refresh it
  // using the stored refresh token instead of kicking the user to /login.
  if (isExpiringSoon(sessionData.expires_at) && sessionData.refresh_token) {
    const refreshed = await refreshSupabaseSession(sessionData.refresh_token)
    if (refreshed) {
      const res = NextResponse.next()
      writeSessionCookies(
        res,
        request.cookies.getAll().map((c) => c.name),
        refreshed,
        request.url.startsWith('https')
      )
      return res
    }
    // Refresh failed. If the token still has time left (e.g. transient
    // network error during the pre-expiry buffer), let the request through
    // and retry on the next one. Only redirect once it's truly dead.
  }

  if (isExpired(sessionData.expires_at)) {
    const loginUrl = new URL(request.url)
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // User has a valid session cookie - let them through
  return NextResponse.next()
}

export const config = {
  // Exclude API routes and static files from middleware entirely
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
