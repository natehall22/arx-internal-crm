import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { classifyHost } from '@/lib/company-host'
import { getGoogleAuthUrl } from '@/lib/google-calendar'
import { issueOAuthState } from '@/lib/google-oauth-state'
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
    } catch {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const host = request.headers.get('host') ?? request.nextUrl.host
    if (classifyHost(host).kind !== 'company') {
      return NextResponse.redirect(getGoogleAuthUrl(auth.authUser.id))
    }

    // requireAuthApi already proved this user belongs to the company at this address.
    const state = await issueOAuthState(createServiceClient(), {
      userId: auth.authUser.id,
      orgId: auth.profile.org_id,
      returnHost: host,
    })
    if (!state) {
      return NextResponse.json({ error: 'Google Calendar connect is unavailable right now. Please try again.' }, { status: 503 })
    }
    return NextResponse.redirect(getGoogleAuthUrl(state))
  } catch (error) {
    console.error('Google auth error:', error)
    return NextResponse.json({ error: 'Failed to initiate Google authentication' }, { status: 500 })
  }
}
