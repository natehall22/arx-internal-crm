import { NextRequest, NextResponse } from 'next/server'
import { CompanyLookupUnavailableError, requireAuthApi } from '@/lib/auth'
import { COMPANY_LOOKUP_UNAVAILABLE, classifyHost, requestHost } from '@/lib/company-host'
import { saveGoogleConnection } from '@/lib/google-calendar'
import {
  GOOGLE_CONNECT_COOKIE,
  GOOGLE_CONNECT_COOKIE_PATH,
  discardOAuthTicket,
  finishOAuthConnect,
} from '@/lib/google-oauth-state'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Last step of Google Calendar connect started on a company address (lib/google-oauth-state.ts): stores the
 * connection only for the signed-in user who started it, in the browser that started it. Anything else discards it.
 */
export async function GET(request: NextRequest) {
  const host = requestHost(request)
  if (classifyHost(host).kind !== 'company') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${q}`, request.url))
    res.cookies.set(GOOGLE_CONNECT_COOKIE, '', { path: GOOGLE_CONNECT_COOKIE_PATH, httpOnly: true, maxAge: 0 })
    return res
  }

  const nonce = request.nextUrl.searchParams.get('nonce')
  let auth
  try {
    auth = await requireAuthApi()
  } catch (e) {
    // Can't prove who this is: burn the ticket (and its sealed code) on every path, then answer.
    await discardOAuthTicket(createServiceClient(), nonce)
    if (e instanceof CompanyLookupUnavailableError) {
      const res = NextResponse.json({ error: 'Temporarily unavailable', code: COMPANY_LOOKUP_UNAVAILABLE }, { status: 503 })
      res.cookies.set(GOOGLE_CONNECT_COOKIE, '', { path: GOOGLE_CONNECT_COOKIE_PATH, httpOnly: true, maxAge: 0 })
      return res
    }
    return done('error=invalid_state')
  }

  try {
    const admin = createServiceClient()
    const result = await finishOAuthConnect(admin, {
      nonce,
      cookieNonce: request.cookies.get(GOOGLE_CONNECT_COOKIE)?.value,
      userId: auth.authUser.id,
      orgId: auth.profile.org_id,
    })
    if (!result.ok) {
      console.error('Google connect finish refused:', result.reason)
      return done(result.reason === 'unavailable' ? 'error=callback_failed' : 'error=invalid_state')
    }
    const saved = await saveGoogleConnection(admin, result.code, auth.authUser.id, auth.profile.org_id)
    return done(saved ? 'success=calendar_connected' : 'error=token_storage')
  } catch (e) {
    console.error('Google connect finish error:', e)
    await discardOAuthTicket(createServiceClient(), nonce)
    return done('error=callback_failed')
  }
}
