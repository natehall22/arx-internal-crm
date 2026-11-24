import { categoryScopeOf } from '@/lib/category-scope'
import { NextResponse } from 'next/server'

import { orderCrewDay } from '@/lib/crew-route'
import { isYmd } from '@/lib/service-plans'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ops/visits/order — the stop order of ONE crew's day. body: { crew, day, action: 'best' } (nearest stop first, then 2-opt,
 * free and from the company address) or { crew, day, action: 'set', order: [visitId, …] } (the order the person arranged: every stop
 * still to do, once). Writes the stop numbers through the plan writer (lib/crew-route.ts). Same permission as editing visits (jobs:edit).
 * Answers the estimated straight-line miles before and after.
 */
export async function POST(request: Request) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  // A whole crew's day spans every customer: a person limited to some work categories cannot use it.
  if (categoryScopeOf(ctx.profile).limited) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await request.json().catch(() => null)) as { crew?: unknown; day?: unknown; action?: unknown; order?: unknown } | null
  const crew = typeof b?.crew === 'string' ? b.crew : ''
  if (!crew || !isYmd(b?.day)) return NextResponse.json({ error: 'Pick a crew and a day' }, { status: 400 })
  if (b?.action !== 'best' && b?.action !== 'set') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const order = Array.isArray(b?.order) && b.order.every((x) => typeof x === 'string') ? (b.order as string[]) : undefined
  if (b?.action === 'set' && !order) return NextResponse.json({ error: 'Send the order' }, { status: 400 })
  const res = await orderCrewDay(ctx.admin, ctx.orgId, { subId: crew, day: b.day as string, mode: b.action, order })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json(res)
}
