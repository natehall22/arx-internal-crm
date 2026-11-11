/**
 * The door for every portal API route: same-origin writes only, a live portal session (never a staff session), a read/write
 * budget per session, and no caching. A route gets `{ admin, session, ip }` or a ready-made refusal.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { clientIpFromRequest } from '@/lib/public-estimate-rate-limit'
import { getPortalSession, PORTAL_LIMITS, takePortalAttempt, type PortalSession } from '@/lib/portal/server'
import { createServiceClient } from '@/lib/supabase/service'

export const PORTAL_NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' }

export const portalJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PORTAL_NO_STORE })

export type PortalCaller = { admin: SupabaseClient; session: PortalSession; ip: string }

export async function requirePortalApi(request: Request): Promise<PortalCaller | NextResponse> {
  if (request.method !== 'GET' && crossSiteWrite(request)) return portalJson({ error: 'Forbidden' }, 403)
  const admin = createServiceClient()
  const session = await getPortalSession(admin)
  if (!session) return portalJson({ error: 'Please sign in again.', code: 'signed_out' }, 401)
  if (!(await takePortalAttempt(admin, `use:${session.sessionId}`, PORTAL_LIMITS.readsPerSession))) return portalJson({ error: 'Too many requests. Please wait a few minutes.' }, 429)
  return { admin, session, ip: clientIpFromRequest(request) }
}

/** A 303 to a page of this app (relative, so it works on whatever company address the request came to). */
export function seeOther(path: string, init?: { setCookie?: (res: NextResponse) => void }): NextResponse {
  const res = new NextResponse(null, { status: 303, headers: { Location: path, ...PORTAL_NO_STORE } })
  init?.setCookie?.(res)
  return res
}
