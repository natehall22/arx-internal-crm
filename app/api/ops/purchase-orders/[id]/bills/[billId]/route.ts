/** DELETE — void a bill (it was entered by mistake): its job cost line drops out of the ledger too. Nothing is hard-deleted. */
import { NextRequest, NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { isUuid } from '@/lib/purchase-orders'
import { voidPoBill } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, { params }: { params: { id: string; billId: string } }) {
  const a = await authorizePo('canBill')
  if ('error' in a) return a.error
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isUuid(params.billId)) return NextResponse.json({ error: 'Bill not found.' }, { status: 404 })
  const r = await voidPoBill(a.ctx.admin, a.ctx.orgId, a.ctx.authUser.id, params.id, params.billId)
  return r.ok ? NextResponse.json({ ok: true, status: r.status }) : NextResponse.json({ error: r.message }, { status: 409 })
}
