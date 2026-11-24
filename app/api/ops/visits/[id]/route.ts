import { NextResponse } from 'next/server'

import { categoryScopeOf, visitInScope } from '@/lib/category-scope'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { applyVisitAction } from '@/lib/service-plans-db'
import { parseVisitAction } from '@/lib/service-plans'

export const dynamic = 'force-dynamic'

/** POST — one visit: `{ action: 'done' | 'skip' (reason) | 'reopen' | 'move' (date) | 'assign' (subId) }`. jobs:edit only. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  if (!(await visitInScope(ctx.admin, ctx.orgId, categoryScopeOf(ctx.profile), params.id))) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const action = parseVisitAction(await request.json().catch(() => null))
  if ('error' in action) return NextResponse.json({ error: action.error }, { status: 400 })
  const res = await applyVisitAction(ctx.admin, ctx.orgId, params.id, action, { userId: ctx.userId, subId: null })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
