import { NextResponse, type NextRequest } from 'next/server'

import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import { clearSessionCookies, revokeSupabaseSession } from '@/lib/supabase/session-refresh'

/**
 * Logout ends the Supabase session server-side (scope=local, this device only), then clears the session cookie the login route actually wrote (name from the Supabase project, single or chunked).
 * POST answers JSON for fetch callers; GET (plain link) redirects to /login on the SAME host — a relative Location, so it
 * never jumps to another address (old/new domain, per-company host).
 */
function cleared(request: NextRequest, res: NextResponse): NextResponse {
  clearSessionCookies(
    res,
    request.cookies.getAll().map((c) => c.name),
    request.nextUrl.protocol === 'https:'
  )
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Ends the session at Supabase first (best effort, time-boxed), THEN clears cookies — cookies clear whatever happens. */
async function endSession(request: NextRequest): Promise<void> {
  try {
    await revokeSupabaseSession(getSupabaseSessionFromCookieStore(request.cookies))
  } catch {
    // cookies are cleared regardless
  }
}

export async function POST(request: NextRequest) {
  await endSession(request)
  return cleared(request, NextResponse.json({ success: true }))
}

export async function GET(request: NextRequest) {
  await endSession(request)
  return cleared(request, new NextResponse(null, { status: 303, headers: { Location: '/login' } }))
}
