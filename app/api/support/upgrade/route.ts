import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { createServiceClient } from '@/lib/supabase/service'
import { checkSupportSession, logSupportEvent } from '@/lib/support/access'
import { setSupportCookie } from '@/lib/support/cookie'
import { supportCookieFrom, verifySupportToken } from '@/lib/support/token'

export const dynamic = 'force-dynamic'

/** POST — switch the current support session from view-only to full. Re-checks everything, logs 'upgrade' first (no log, no upgrade). */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const payload = await verifySupportToken(supportCookieFrom(cookies()), 'session')
  if (!payload) return NextResponse.json({ error: 'Not in a support session' }, { status: 401 })
  const admin = createServiceClient()
  const checked = await checkSupportSession(admin, payload)
  if (checked.status !== 'ok') return NextResponse.json({ error: 'Support access has ended' }, { status: 403 })
  if (payload.l === 'full') return NextResponse.json({ ok: true, level: 'full' })
  try {
    await logSupportEvent(admin, { orgId: payload.o, staffUserId: payload.s, actingAsUserId: payload.a, level: 'full', event: 'upgrade', detail: { from: 'view' } })
  } catch (e) {
    console.error('[support] upgrade refused: could not record it', e)
    return NextResponse.json({ error: 'Could not record the upgrade, so it was refused.' }, { status: 500 })
  }
  const res = NextResponse.json({ ok: true, level: 'full' })
  await setSupportCookie(res, { ...payload, l: 'full' }, new URL(request.url).protocol === 'https:')
  return res
}
