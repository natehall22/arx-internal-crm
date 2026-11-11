import { NextResponse } from 'next/server'

import { loadCustomerProperties } from '@/lib/properties-db'
import { propertyDisplayName } from '@/lib/properties'
import { activeTrades, loadOrgTrades } from '@/lib/org-trades'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_PLANS_NOT_READY, createServicePlan, loadServicePlans, loadTemplates } from '@/lib/service-plans-db'
import { redactPlanPrices, type PlanPricing } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

function hideTierPrices(p: PlanPricing, prices: boolean): PlanPricing {
  return prices ? p : { ...p, tiers: p.tiers.map((t) => ({ ...t, price: 0 })) }
}

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
  const [plans, props, trades, subs, users, templates] = await Promise.all([
    loadServicePlans(ctx.admin, ctx.orgId, { customerId: params.id }),
    loadCustomerProperties(ctx.admin, ctx.orgId, params.id, { accessNotes: false }),
    loadOrgTrades(ctx.admin, ctx.orgId),
    orgDb(ctx.admin, ctx.orgId).from('sub_contractors').select('id, company_name').eq('active', true).order('company_name'),
    ctx.access.edit ? orgDb(ctx.admin, ctx.orgId).from('users').select('id, full_name').eq('active', true).order('full_name') : Promise.resolve({ data: [] }),
    loadTemplates(ctx.admin, ctx.orgId, { activeOnly: true }),
  ])
  return NextResponse.json({
    ready: plans.ready,
    plans: plans.plans.map((p) => ({ ...redactPlanPrices(p, ctx.access.prices), pricing: hideTierPrices(p.pricing, ctx.access.prices) })),
    canEdit: ctx.access.edit,
    prices: ctx.access.prices,
    properties: props.properties.map((p) => ({ id: p.id, name: propertyDisplayName(p) })),
    trades: activeTrades(trades).map((t) => ({ slug: t.slug, label: t.label })),
    crews: ((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => ({ id: s.id, name: s.company_name ?? 'Crew' })),
    // Who can do a follow-on step (editors only).
    people: ((users.data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => ({ id: u.id, name: u.full_name || 'Unnamed user' })),
    // What the company sells: a new plan starts from one of these (copied at sale).
    templates: templates.templates.map((t) => ({ ...t, pricing: hideTierPrices(t.pricing, ctx.access.prices) })),
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
