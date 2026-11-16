import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { createServiceClient } from '@/lib/supabase/service'
import { logSupportEvent } from '@/lib/support/access'
import { clearSupportCookie } from '@/lib/support/cookie'
import { supportCookieFrom, verifySupportToken } from '@/lib/support/token'

export const dynamic = 'force-dynamic'

/** POST — leave the support session: logs 'exit' and clears the cookie. Works even when the grant has just ended. */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const payload = await verifySupportToken(supportCookieFrom(cookies()), 'session')
  if (payload) {
    try {
      await logSupportEvent(createServiceClient(), { orgId: payload.o, staffUserId: payload.s, actingAsUserId: payload.a, level: payload.l, event: 'exit' })
    } catch (e) {
      console.error('[support] could not log exit', e)
    }
  }
  const res = NextResponse.json({ ok: true })
  clearSupportCookie(res, new URL(request.url).protocol === 'https:')
  return res
}
