/** GET one PO (lines, bills) · DELETE a draft that was never sent. */
import { NextRequest, NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { discardPoDraft, loadPurchaseOrder } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorizePo('canView')
  if ('error' in a) return a.error
  const po = await loadPurchaseOrder(a.ctx.admin, a.ctx.orgId, params.id, { showMoney: a.ctx.access.canSeeMoney })
  if (!po) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  return NextResponse.json({ order: po })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorizePo('canEdit')
  if ('error' in a) return a.error
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const r = await discardPoDraft(a.ctx.admin, a.ctx.orgId, params.id)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 409 })
}
