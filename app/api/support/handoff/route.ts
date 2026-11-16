import { NextResponse } from 'next/server'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestCompanyFence } from '@/lib/company-host-server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkSupportSession, sessionExpiry } from '@/lib/support/access'
import { setSupportCookie } from '@/lib/support/cookie'
import { verifySupportToken } from '@/lib/support/token'

export const dynamic = 'force-dynamic'

/**
 * GET ?t=<hand-off token> — the company's own address receives staff who entered from another address (cookies are host-only).
 * The token is signed, one minute old at most, and names exactly one company: it only works on an address that company's fence
 * allows, and everything is re-checked against the database before the cookie is set. 404 on any failure (no hints).
 */
export async function GET(request: Request) {
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
  const token = new URL(request.url).searchParams.get('t')
  const payload = await verifySupportToken(token, 'handoff')
  if (!payload) return notFound()
  const fence = await getRequestCompanyFence()
  if (fence.kind !== 'org' || !fenceAllowsOrg(fence, payload.o)) return notFound() // only a company's own address (never an unfenced one)
  const admin = createServiceClient()
  const checked = await checkSupportSession(admin, { ...payload, k: 'session' })
  if (checked.status !== 'ok') return notFound()
  const res = NextResponse.redirect(new URL('/today', request.url), { status: 303, headers: { 'cache-control': 'no-store' } })
  await setSupportCookie(res, { ...payload, k: 'session', exp: sessionExpiry(checked.support.access, Date.now()) }, new URL(request.url).protocol === 'https:')
  return res
}
