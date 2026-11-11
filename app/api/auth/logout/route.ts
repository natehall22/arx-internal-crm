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

/** Ends the session at Supabase first (best effort, ONE 4 s deadline for refresh + logout), and ALWAYS answers with the cookies cleared. */
async function endSessionThenClear(request: NextRequest, make: () => NextResponse): Promise<NextResponse> {
  try {
    await revokeSupabaseSession(getSupabaseSessionFromCookieStore(request.cookies))
  } catch {
    // fall through: the cookies are cleared regardless
  }
  return cleared(request, make())
}

export async function POST(request: NextRequest) {
  return endSessionThenClear(request, () => NextResponse.json({ success: true }))
}

export async function GET(request: NextRequest) {
  return endSessionThenClear(request, () => new NextResponse(null, { status: 303, headers: { Location: '/login' } }))
}
