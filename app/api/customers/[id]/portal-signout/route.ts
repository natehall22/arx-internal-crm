import { NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { logPortalEvent, revokeCustomerPortalAccess } from '@/lib/portal/server'
import { orgDb } from '@/lib/supabase/org-db'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

/** POST — staff: end every portal session of this customer and cancel their unused sign-in links. Owners, managers and ops only. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const { admin, viewer } = ctx
  if (!(viewer.ownerLike || viewer.managerLike || viewer.jobBoard)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await isOrgFeatureOn(viewer.orgId, 'customerPortal'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data } = await orgDb(admin, viewer.orgId).from('customers').select('id').eq('id', params.id).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await revokeCustomerPortalAccess(admin, viewer.orgId, params.id)
  await logPortalEvent(admin, viewer.orgId, { kind: 'staff_signout', customerId: params.id, detail: `by ${viewer.userId}` })
  return NextResponse.json({ ok: true })
}
