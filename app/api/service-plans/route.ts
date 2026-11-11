import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_PLANS_NOT_READY, createCustomerWithPlan } from '@/lib/service-plans-db'
import { loadPlanEditorOptions } from '@/lib/service-plans-options'
import { redactPlanPrices } from '@/lib/service-plans'

export const dynamic = 'force-dynamic'

/** GET — what the plan form needs for a NEW customer (service types, crews, people, plan types). Editors only. */
export async function GET() {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  return NextResponse.json(await loadPlanEditorOptions(ctx.admin, ctx.orgId, ctx.access, null))
}

/**
 * POST { customer: { name, phone?, email? }, property: { address_line1, city?, state?, zip?, access_notes? }, plan } —
 * "New customer + plan" in one go. A phone / email already on file reuses that customer (`matchedExisting`).
 */
export async function POST(request: Request) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const body = await request.json().catch(() => null)
  // Plan editors work the job board; they may write gate / access notes for the crew.
  const r = await createCustomerWithPlan(ctx.admin, ctx.orgId, ctx.userId, body, { accessNotes: true })
  if (!r.ok) return NextResponse.json({ error: r.status === 503 ? SERVICE_PLANS_NOT_READY : r.error, customerId: r.customerId ?? null }, { status: r.status })
  return NextResponse.json({ customerId: r.customerId, matchedExisting: r.matchedExisting, plan: redactPlanPrices(r.plan, ctx.access.prices) }, { status: 201 })
}
