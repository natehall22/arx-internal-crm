/** POST { all: true } | { lines: [{ lineId, quantity }] } — record what arrived / was done. Partial quantities are fine. */
import { NextRequest, NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { isUuid } from '@/lib/purchase-orders'
import { receivePo } from '@/lib/purchase-orders-db'
import { authorizePo } from '@/lib/purchase-orders-route'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await authorizePo('canEdit')
  if ('error' in a) return a.error
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { all?: boolean; lines?: { lineId?: unknown; quantity?: unknown }[] } | null
  let change
  if (body?.all === true) change = { all: true as const }
  else if (Array.isArray(body?.lines) && body!.lines.length > 0 && body!.lines.length <= 100 && body!.lines.every((l) => isUuid(l.lineId) && typeof l.quantity === 'number')) {
    change = { lines: body!.lines.map((l) => ({ lineId: l.lineId as string, quantity: l.quantity as number })) }
  } else return NextResponse.json({ error: 'Say what was received.' }, { status: 400 })
  const r = await receivePo(a.ctx.admin, a.ctx.orgId, params.id, change)
  return r.ok ? NextResponse.json({ ok: true, status: r.status }) : NextResponse.json({ error: r.message }, { status: r.status })
}
