import { NextResponse } from 'next/server'

import { fenceAllowsOrg, companyAppUrl } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { createServiceClient } from '@/lib/supabase/service'
import { enterSupportSession } from '@/lib/support/access'
import { requirePlatformStaffApi } from '@/lib/support/staff'
import { SUPPORT_HANDOFF_MAX_MS, signSupportToken } from '@/lib/support/token'
import { setSupportCookie } from '@/lib/support/cookie'

export const dynamic = 'force-dynamic'

/**
 * POST { orgId, actingAsUserId? } — platform staff only. Starts a support session (view-only) as the company's owner, or as
 * the named active user. On an address that may serve that company the cookie is set here; otherwise the answer is a one-minute
 * hand-off link on the company's own address (lib/support/token.ts), which sets it there.
 */
export async function POST(request: Request) {
  const guard = await requirePlatformStaffApi(request)
  if ('error' in guard) return guard.error
  const body = (await request.json().catch(() => null)) as { orgId?: unknown; actingAsUserId?: unknown } | null
  const orgId = typeof body?.orgId === 'string' ? body.orgId : ''
  const actingAs = typeof body?.actingAsUserId === 'string' && body.actingAsUserId ? body.actingAsUserId : null
  if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const admin = createServiceClient()
  const entered = await enterSupportSession(admin, { staffUserId: guard.ctx.authUser.id, orgId, actingAsUserId: actingAs })
  if (!entered.ok) return NextResponse.json({ error: entered.error }, { status: entered.status })

  const secure = new URL(request.url).protocol === 'https:'
  const fence = await getRequestHostFence() // the cookie is set for this host: only the host decides, never a client header
  if (fenceAllowsOrg(fence, orgId)) {
    const res = NextResponse.json({ ok: true, redirect: '/today' })
    await setSupportCookie(res, entered.payload, secure)
    return res
  }
  const { data: org } = await admin.from('orgs').select('subdomain').eq('id', orgId).maybeSingle()
  const url = companyAppUrl((org as { subdomain?: string | null } | null)?.subdomain ?? null)
  const token = url ? await signSupportToken({ ...entered.payload, k: 'handoff', n: crypto.randomUUID(), exp: Math.min(entered.payload.exp, Date.now() + SUPPORT_HANDOFF_MAX_MS) }) : null
  if (!url || !token) return NextResponse.json({ error: "Open this company's own web address to enter it." }, { status: 409 })
  return NextResponse.json({ ok: true, redirect: `${url.replace(/\/+$/, '')}/api/support/handoff?t=${encodeURIComponent(token)}` })
}
