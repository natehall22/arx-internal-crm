import { NextResponse } from 'next/server'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkSupportSession, logSupportEvent, sessionExpiry } from '@/lib/support/access'
import { setSupportCookie } from '@/lib/support/cookie'
import { verifySupportToken } from '@/lib/support/token'

export const dynamic = 'force-dynamic'

/**
 * GET ?t=<hand-off token> — the company's own address receives staff who entered from another address (cookies are host-only).
 * The token is signed, one minute old at most, names exactly one company and is good ONCE: it only works on an address whose
 * host serves that company (never a client header, never an unfenced address), everything is re-checked against the database,
 * and its one-time id is written to the log (a unique index refuses a second use) before the cookie is set. 404 on any failure.
 */
export async function GET(request: Request) {
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
  const token = new URL(request.url).searchParams.get('t')
  const payload = await verifySupportToken(token, 'handoff')
  if (!payload?.n) return notFound()
  const fence = await getRequestHostFence()
  if (fence.kind !== 'org' || !fenceAllowsOrg(fence, payload.o)) return notFound()
  const admin = createServiceClient()
  const checked = await checkSupportSession(admin, { ...payload, k: 'session' })
  if (checked.status !== 'ok') return notFound()
  try {
    await logSupportEvent(admin, { orgId: payload.o, staffUserId: payload.s, actingAsUserId: payload.a, level: payload.l, event: 'enter', detail: { via: 'handoff' }, handoffId: payload.n })
  } catch (e) {
    console.error('[support] hand-off refused (already used, or the log could not be written)', e)
    return notFound()
  }
  const res = NextResponse.redirect(new URL('/today', request.url), { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
  const { n: _used, ...session } = payload
  void _used
  await setSupportCookie(res, { ...session, k: 'session', exp: sessionExpiry(checked.support.access, Date.now()) }, new URL(request.url).protocol === 'https:')
  return res
}
