import { NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { createStaffSignInLink } from '@/lib/portal/invite'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

/** POST — owners/admins only: a one-time, 20-minute sign-in link for this customer's portal, for staff to open or hand over (only its hash is stored, logged; nothing is emailed). Body { invite: true } is the explicit choice that also invites an uninvited customer of an invite-only company. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const { viewer } = ctx
  if (!viewer.ownerLike) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOrgFeatureOn(viewer.orgId, 'customerPortal'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { invite?: unknown } | null
  const r = await createStaffSignInLink(ctx.admin, viewer.orgId, params.id, viewer.userId, { invite: body?.invite === true })
  return r.ok ? NextResponse.json({ ok: true, url: r.url, minutes: r.minutes, invited: r.invited }, { headers: NO_STORE }) : NextResponse.json({ error: r.error, needsInvite: r.needsInvite === true }, { status: r.status, headers: NO_STORE })
}
