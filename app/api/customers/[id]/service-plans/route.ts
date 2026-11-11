import { NextResponse } from 'next/server'

import { loadCustomerProperties } from '@/lib/properties-db'
import { propertyDisplayName } from '@/lib/properties'
import { activeTrades, loadOrgTrades } from '@/lib/org-trades'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_PLANS_NOT_READY, createServicePlan, loadServicePlans } from '@/lib/service-plans-db'
import { redactPlanPrices } from '@/lib/service-plans'
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
  const [plans, props, trades, subs] = await Promise.all([
    loadServicePlans(ctx.admin, ctx.orgId, { customerId: params.id }),
    loadCustomerProperties(ctx.admin, ctx.orgId, params.id, { accessNotes: false }),
    loadOrgTrades(ctx.admin, ctx.orgId),
    orgDb(ctx.admin, ctx.orgId).from('sub_contractors').select('id, company_name').eq('active', true).order('company_name'),
  ])
  return NextResponse.json({
    ready: plans.ready,
    plans: plans.plans.map((p) => redactPlanPrices(p, ctx.access.prices)),
    canEdit: ctx.access.edit,
    prices: ctx.access.prices,
    properties: props.properties.map((p) => ({ id: p.id, name: propertyDisplayName(p) })),
    trades: activeTrades(trades).map((t) => ({ slug: t.slug, label: t.label })),
    crews: ((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => ({ id: s.id, name: s.company_name ?? 'Crew' })),
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
