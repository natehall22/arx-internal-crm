import { NextResponse } from 'next/server'

import { activeTrades, loadOrgTrades } from '@/lib/org-trades'
import { STARTER_TEMPLATES } from '@/lib/service-plan-starters'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_PLANS_NOT_READY, loadTemplates, saveTemplate } from '@/lib/service-plans-db'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * GET — the company's plan templates (anyone who works plans sees them to sell from; prices only for those who may see
 * prices), plus what the owner's editor needs (starters, trades, crews, people). POST — a new template (owners).
 */
export async function GET() {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const { ready, templates } = await loadTemplates(ctx.admin, ctx.orgId, { activeOnly: !ctx.owner })
  const hidePrices = !ctx.access.prices && !ctx.owner
  const db = orgDb(ctx.admin, ctx.orgId)
  const [trades, subs, users] = ctx.owner
    ? await Promise.all([
        loadOrgTrades(ctx.admin, ctx.orgId),
        db.from('sub_contractors').select('id, company_name').eq('active', true).order('company_name'),
        db.from('users').select('id, full_name').eq('active', true).order('full_name'),
      ])
    : [[], { data: [] }, { data: [] }]
  return NextResponse.json({
    ready,
    canEdit: ctx.owner,
    templates: hidePrices ? templates.map((t) => ({ ...t, pricing: { ...t.pricing, tiers: t.pricing.tiers.map((x) => ({ ...x, price: null })) } })) : templates,
    starters: ctx.owner ? STARTER_TEMPLATES : [],
    trades: activeTrades(trades).map((t) => ({ slug: t.slug, label: t.label })),
    crews: ((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => ({ id: s.id, name: s.company_name ?? 'Crew' })),
    people: ((users.data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => ({ id: u.id, name: u.full_name || 'Unnamed user' })),
  })
}

export async function POST(request: Request) {
  const ctx = await servicePlanRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  const r = await saveTemplate(ctx.admin, ctx.orgId, ctx.userId, null, await request.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.status === 503 ? SERVICE_PLANS_NOT_READY : r.error }, { status: r.status })
  return NextResponse.json({ template: r.template }, { status: 201 })
}
