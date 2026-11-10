import { NextRequest, NextResponse } from 'next/server'
import { CompanyLookupUnavailableError, requireAuthApi } from '@/lib/auth'
import { COMPANY_LOOKUP_UNAVAILABLE, classifyHost } from '@/lib/company-host'
import { getGoogleAuthUrl } from '@/lib/google-calendar'
import {
  GOOGLE_CONNECT_COOKIE,
  GOOGLE_CONNECT_COOKIE_PATH,
  OAUTH_STATE_TTL_MS,
  issueOAuthState,
} from '@/lib/google-oauth-state'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Start Google Calendar connect. Legacy address: state = user id, the callback checks the session cookie (unchanged).
 * Company address: Google returns to the one fixed GOOGLE_REDIRECT_URI where this address's host-only cookie isn't
 * sent, so the state is a signed, single-use ticket instead (lib/google-oauth-state.ts).
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('Google Calendar integration not configured: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing')
      return NextResponse.json(
        { error: 'Google Calendar integration is not configured. Please contact your administrator.' },
        { status: 503 }
      )
    }

    let auth
    try {
      auth = await requireAuthApi()
    } catch (e) {
      if (e instanceof CompanyLookupUnavailableError) {
        return NextResponse.json({ error: 'Temporarily unavailable', code: COMPANY_LOOKUP_UNAVAILABLE }, { status: 503 })
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const host = request.headers.get('host') ?? request.nextUrl.host
    if (classifyHost(host).kind !== 'company') {
      return NextResponse.redirect(getGoogleAuthUrl(auth.authUser.id))
    }

    // requireAuthApi already proved this user belongs to the company at this address.
    const ticket = await issueOAuthState(createServiceClient(), {
      userId: auth.authUser.id,
      orgId: auth.profile.org_id,
      returnHost: host,
    })
    if (!ticket) {
      return NextResponse.json({ error: 'Google Calendar connect is unavailable right now. Please try again.' }, { status: 503 })
    }
    const res = NextResponse.redirect(getGoogleAuthUrl(ticket.state))
    // Binds this connect to THIS browser: the finish step refuses without it. Host-only (no Domain), httpOnly.
    res.cookies.set(GOOGLE_CONNECT_COOKIE, ticket.nonce, {
      path: GOOGLE_CONNECT_COOKIE_PATH,
      httpOnly: true,
      secure: request.url.startsWith('https'),
      sameSite: 'lax',
      maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    })
    return res
  } catch (error) {
    console.error('Google auth error:', error)
    return NextResponse.json({ error: 'Failed to initiate Google authentication' }, { status: 500 })
  }
}
