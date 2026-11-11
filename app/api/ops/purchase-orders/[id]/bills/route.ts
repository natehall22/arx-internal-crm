/**
 * POST { amount, billNumber?, billDate?, isCredit?, notes?, costType?, confirmOver?, confirmDuplicate? } — record a vendor bill against this PO.
 * The cost lands in the job ledger through addJobCostLine (the one writer) once per bill. The bill's file is attached with the
 * existing cost-attachments route using the returned costLineId (drag and drop on the screen).
 */
import { NextRequest, NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { parseBillInput } from '@/lib/purchase-orders'
import { recordPoBill } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorizePo('canBill')
  if ('error' in a) return a.error
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const parsed = parseBillInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const r = await recordPoBill(a.ctx.admin, a.ctx.orgId, a.ctx.authUser.id, params.id, parsed.value, { over: body?.confirmOver === true, duplicate: body?.confirmDuplicate === true })
  if (!r.ok) return NextResponse.json({ error: r.message, needsConfirm: r.needsConfirm ?? false, confirmKind: r.confirmKind ?? null }, { status: r.status })
  return NextResponse.json(r)
}
