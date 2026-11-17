import { NextRequest, NextResponse } from 'next/server'

import { microsoftConfigured, getMicrosoftAuthUrl } from '@/lib/calendar/microsoft-calendar'
import { MICROSOFT_CONNECT_COOKIE, MICROSOFT_CONNECT_COOKIE_PATH } from '@/lib/calendar/microsoft-connect'
import { CompanyLookupUnavailableError, requireAuthApi } from '@/lib/auth'
import { COMPANY_LOOKUP_UNAVAILABLE, requestHost } from '@/lib/company-host'
import { OAUTH_STATE_TTL_MS, issueOAuthState, pkceFor } from '@/lib/google-oauth-state'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Start Outlook (Microsoft 365) calendar connect. Always the signed, single-use ticket + PKCE (never a bare user id as
 * state): the ticket binds the connect to this user, this company and this browser (httpOnly cookie), and the PKCE
 * verifier is derived server-side from the ticket, so a code that someone else obtained can't be redeemed here.
 */
export async function GET(request: NextRequest) {
  try {
    if (!microsoftConfigured()) {
      return NextResponse.json({ error: 'Outlook calendar is not set up on this server.' }, { status: 503 })
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
    const ticket = await issueOAuthState(createServiceClient(), {
      userId: auth.authUser.id,
      orgId: auth.profile.org_id,
      returnHost: requestHost(request),
      purpose: 'microsoft',
    })
    const pkce = ticket ? pkceFor(ticket.nonce) : null
    if (!ticket || !pkce) {
      return NextResponse.json({ error: 'Outlook connect is unavailable right now. Please try again.' }, { status: 503 })
    }
    const res = NextResponse.redirect(getMicrosoftAuthUrl(ticket.state, pkce.challenge))
    res.cookies.set(MICROSOFT_CONNECT_COOKIE, ticket.nonce, {
      path: MICROSOFT_CONNECT_COOKIE_PATH,
      httpOnly: true,
      secure: request.url.startsWith('https'),
      sameSite: 'lax',
      maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    })
    return res
  } catch (error) {
    console.error('Microsoft auth error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to initiate Outlook authentication' }, { status: 500 })
  }
}
