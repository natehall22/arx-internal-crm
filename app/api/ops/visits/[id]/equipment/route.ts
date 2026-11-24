import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { loadEquipmentChoices } from '@/lib/time-tracking-db'
import { loadVisitEquipmentView, saveVisitEquipment } from '@/lib/truck-sheet-db'

export const dynamic = 'force-dynamic'

/** GET — one visit's machines: its own list (null = the plan's), the plan's default, and the machines the company has (the time clock's list). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const view = await loadVisitEquipmentView(ctx.admin, ctx.orgId, params.id)
  if (!view) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const machines = await loadEquipmentChoices(ctx.admin, ctx.orgId)
  return NextResponse.json({ ...view, machines })
}

/** POST `{ equipment_item_ids: string[] | null }` — set this visit's own machines (null = use the plan's). jobs:edit; a visit still to do. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const body = (await request.json().catch(() => null)) as { equipment_item_ids?: unknown } | null
  if (!body || !('equipment_item_ids' in body)) return NextResponse.json({ error: 'Pick the machines' }, { status: 400 })
  const res = await saveVisitEquipment(ctx.admin, ctx.orgId, params.id, body.equipment_item_ids)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, own: res.ids })
}
