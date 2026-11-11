import { NextResponse } from 'next/server'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { updateServicePlan } from '@/lib/service-plans-db'
import { parsePlanStatusChange, redactPlanPrices, ymdInZone } from '@/lib/service-plans'

export const dynamic = 'force-dynamic'

/**
 * PATCH — edit a plan, or `{ action: 'pause', until? } | { action: 'resume' } | { action: 'end', on? }`.
 * Future visits that have not started follow the change; done / skipped visits and anything today or earlier never do.
 * `preview: true` = what would change (fields + visits removed / added / updated), nothing written. Optional
 * `expectedUpdatedAt` refuses the save (409) if someone else changed the plan since it was loaded.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const today = ymdInZone(new Date(), await loadOrgTimeZone(ctx.admin, ctx.orgId))
  const change = parsePlanStatusChange(body, today)
  if (change && 'error' in change) return NextResponse.json({ error: change.error }, { status: 400 })
  const result = await updateServicePlan(ctx.admin, ctx.orgId, ctx.userId, params.id, body, change)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  if ('preview' in result) return NextResponse.json(result)
  return NextResponse.json({ plan: redactPlanPrices(result.plan, ctx.access.prices), effect: result.effect })
}
