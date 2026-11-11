import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { applyVisitAction } from '@/lib/service-plans-db'
import { parseVisitAction } from '@/lib/service-plans'

export const dynamic = 'force-dynamic'

/** POST — one visit: `{ action: 'done' | 'skip' (reason) | 'reopen' | 'move' (date) | 'assign' (subId) }`. jobs:edit only. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const action = parseVisitAction(await request.json().catch(() => null))
  if ('error' in action) return NextResponse.json({ error: action.error }, { status: 400 })
  const res = await applyVisitAction(ctx.admin, ctx.orgId, params.id, action, { userId: ctx.userId, subId: null })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
