import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { SERVICE_PLANS_NOT_READY, createServicePlan, loadServicePlans, loadVisits } from '@/lib/service-plans-db'
import { hideTierPrices, loadPlanEditorOptions } from '@/lib/service-plans-options'
import { isOneOffPlan, redactPlanPrices, visitHorizon, ymdInZone } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

async function customerInOrg(admin: Parameters<typeof orgDb>[0], orgId: string, customerId: string): Promise<boolean> {
  const { data } = await orgDb(admin, orgId).from('customers').select('id').eq('id', customerId).maybeSingle()
  return !!data
}

/** GET — the customer's service plans + what the editor needs (their properties, the company's service types and crews). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  if (!(await customerInOrg(ctx.admin, ctx.orgId, params.id))) return notFound()
  const [plans, options] = await Promise.all([
    loadServicePlans(ctx.admin, ctx.orgId, { customerId: params.id }),
    loadPlanEditorOptions(ctx.admin, ctx.orgId, ctx.access, params.id),
  ])
  // Upcoming one-off visits (a one-off is a plan that makes one visit): listed apart from the recurring plans, each with its visit
  // so the card can move it, change its crew or cancel it.
  const oneOffPlans = plans.plans.filter((p) => isOneOffPlan(p) && p.status === 'active')
  let oneOffs: Array<{ planId: string; visitId: string; name: string; date: string; crew: string | null; workOrderNumber: string | null }> = []
  if (oneOffPlans.length) {
    const today = ymdInZone(new Date(), await loadOrgTimeZone(ctx.admin, ctx.orgId))
    const { from, to } = visitHorizon(today)
    const byPlan = new Map(oneOffPlans.map((p) => [p.id, p]))
    const visits = await loadVisits(ctx.admin, ctx.orgId, { from, to, customerId: params.id, accessNotes: false })
    oneOffs = visits
      .filter((v) => v.status === 'scheduled' && byPlan.has(v.planId))
      .map((v) => ({ planId: v.planId, visitId: v.id, name: v.planName, date: v.scheduledDate, crew: v.subName, workOrderNumber: v.workOrderNumber }))
  }
  return NextResponse.json({
    ready: plans.ready,
    oneOffs,
    plans: plans.plans.filter((p) => !isOneOffPlan(p)).map((p) => ({ ...redactPlanPrices(p, ctx.access.prices), pricing: hideTierPrices(p.pricing, ctx.access.prices) })),
    canEdit: ctx.access.edit,
    ...options,
  })
}

/** POST — start a plan for this customer. body: ServicePlanInput (lib/service-plans.ts). Visits are put on the calendar at once. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  if (!(await customerInOrg(ctx.admin, ctx.orgId, params.id))) return notFound()
  const body = await request.json().catch(() => null)
  const result = await createServicePlan(ctx.admin, ctx.orgId, ctx.userId, params.id, body)
  if (!result.ok) return NextResponse.json({ error: result.status === 503 ? SERVICE_PLANS_NOT_READY : result.error }, { status: result.status })
  return NextResponse.json({ plan: redactPlanPrices(result.plan, ctx.access.prices) }, { status: 201 })
}
