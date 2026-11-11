import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { loadChangeHistory, loadServicePlan } from '@/lib/service-plans-db'

export const dynamic = 'force-dynamic'

/** GET — who changed this plan, when, what, and what it did to visits (newest first). Price changes need price access. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const plan = await loadServicePlan(ctx.admin, ctx.orgId, params.id)
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const history = await loadChangeHistory(ctx.admin, ctx.orgId, { planId: plan.id })
  const priceWords = /^(Price|Price rules|Price tier|Billed): /
  return NextResponse.json({ history: ctx.access.prices ? history : history.map((h) => ({ ...h, lines: h.lines.filter((l) => !priceWords.test(l)) })) })
}
