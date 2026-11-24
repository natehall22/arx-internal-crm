/** POST — staff mark "the vendor confirmed" (by phone or reply), when they did not use the confirm link. */
import { purchaseOrderInScope, recordHiddenFrom } from '@/lib/category-scope'
import { NextRequest, NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { acknowledgeByStaff } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorizePo('canEdit')
  if ('error' in a) return a.error
  if (await recordHiddenFrom(a.ctx.admin, a.ctx.profile, params.id, purchaseOrderInScope)) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const r = await acknowledgeByStaff(a.ctx.admin, a.ctx.orgId, params.id)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 409 })
}
