import { NextRequest, NextResponse } from 'next/server'

import { saveMicrosoftConnection } from '@/lib/calendar/connection'
import { MICROSOFT_CONNECT_COOKIE, MICROSOFT_CONNECT_COOKIE_PATH } from '@/lib/calendar/microsoft-connect'
import { CompanyLookupUnavailableError, requireAuthApi } from '@/lib/auth'
import { COMPANY_LOOKUP_UNAVAILABLE } from '@/lib/company-host'
import { discardOAuthTicket, finishOAuthConnect, pkceFor } from '@/lib/google-oauth-state'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Last step of the Outlook connect: trade the parked code (+ the derived PKCE verifier) for tokens and store them,
 * only for the signed-in user who started it, in the browser that started it. Anything else discards the ticket.
 */
export async function GET(request: NextRequest) {
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${q}`, request.url))
    res.cookies.set(MICROSOFT_CONNECT_COOKIE, '', { path: MICROSOFT_CONNECT_COOKIE_PATH, httpOnly: true, maxAge: 0 })
    return res
  }
  const nonce = request.nextUrl.searchParams.get('nonce')
  const admin = createServiceClient()

  let auth
  try {
    auth = await requireAuthApi()
  } catch (e) {
    await discardOAuthTicket(admin, nonce)
    if (e instanceof CompanyLookupUnavailableError) {
      const res = NextResponse.json({ error: 'Temporarily unavailable', code: COMPANY_LOOKUP_UNAVAILABLE }, { status: 503 })
      res.cookies.set(MICROSOFT_CONNECT_COOKIE, '', { path: MICROSOFT_CONNECT_COOKIE_PATH, httpOnly: true, maxAge: 0 })
      return res
    }
    return done('error=invalid_state')
  }

  try {
    const result = await finishOAuthConnect(admin, {
      nonce,
      cookieNonce: request.cookies.get(MICROSOFT_CONNECT_COOKIE)?.value,
      userId: auth.authUser.id,
      orgId: auth.profile.org_id,
    })
    if (!result.ok) {
      console.error('Microsoft connect finish refused:', result.reason)
      return done(result.reason === 'unavailable' ? 'error=callback_failed' : 'error=invalid_state')
    }
    const pkce = pkceFor(nonce as string)
    if (!pkce) return done('error=callback_failed')
    const saved = await saveMicrosoftConnection(admin, result.code, pkce.verifier, auth.authUser.id, auth.profile.org_id)
    return done(saved ? 'success=calendar_connected' : 'error=token_storage')
  } catch (e) {
    console.error('Microsoft connect finish error:', e instanceof Error ? e.message : e)
    await discardOAuthTicket(admin, nonce)
    return done('error=callback_failed')
  }
}
