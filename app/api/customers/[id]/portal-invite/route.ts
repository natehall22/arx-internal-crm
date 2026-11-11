import { NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { inviteCustomerToPortal, removeCustomerPortalAccess } from '@/lib/portal/invite'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

async function staff(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const { viewer } = ctx
  // Same people as "Sign out of portal": owners, managers, ops.
  if (!(viewer.ownerLike || viewer.managerLike || viewer.jobBoard)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOrgFeatureOn(viewer.orgId, 'customerPortal'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return ctx
}

/** POST — staff: invite this customer to the portal (one tap): marks them invited and emails the sign-in link to the address on file. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await staff(request)
  if (ctx instanceof NextResponse) return ctx
  const r = await inviteCustomerToPortal(ctx.admin, ctx.viewer.orgId, params.id, ctx.viewer.userId)
  return r.ok ? NextResponse.json({ ok: true, sentTo: r.sentTo }) : NextResponse.json({ error: r.error }, { status: r.status })
}

/** DELETE — staff: take portal access away (invitation, open sessions, unused links). */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const ctx = await staff(request)
  if (ctx instanceof NextResponse) return ctx
  return (await removeCustomerPortalAccess(ctx.admin, ctx.viewer.orgId, params.id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
