import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import {
  refreshSupabaseSession,
  writeSessionCookies,
} from '@/lib/supabase/session-refresh'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Session keepalive. Called by <SessionKeepalive /> on an interval and on
 * tab focus so long single-page sessions (e.g. the proposal builder) don't
 * die when the Supabase access token expires. Middleware skips /api/*, so
 * this endpoint is the refresh path for pages the user stays on.
 *
 * Deliberately does NOT use requireAuthApi(): it operates on the session
 * cookie itself (like login/logout) and must work when the access token
 * is already expired.
 */
export async function POST(req: NextRequest) {
  const session = getSupabaseSessionFromCookieStore(req.cookies)

  if (!session?.access_token || !session.refresh_token) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }

  // If the token still has more than 10 minutes left, don't burn a
  // refresh-token rotation — just report the session is healthy.
  const expiresAtMs = (session.expires_at ?? 0) * 1000
  if (expiresAtMs && Date.now() < expiresAtMs - 10 * 60 * 1000) {
    return NextResponse.json({ refreshed: false, ok: true })
  }

  const refreshed = await refreshSupabaseSession(session.refresh_token)
  if (!refreshed) {
    return NextResponse.json({ error: 'Refresh failed' }, { status: 401 })
  }

  const res = NextResponse.json({ refreshed: true, ok: true })
  writeSessionCookies(
    res,
    req.cookies.getAll().map((c) => c.name),
    refreshed,
    req.url.startsWith('https')
  )
  return res
}
