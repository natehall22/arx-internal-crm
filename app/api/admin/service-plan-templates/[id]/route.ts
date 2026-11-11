import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { loadChangeHistory, loadServicePlans, loadTemplate, saveTemplate } from '@/lib/service-plans-db'

export const dynamic = 'force-dynamic'

/** GET — one template with its history and how many plans were sold from it (and how many are on an older version). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  const t = await loadTemplate(ctx.admin, ctx.orgId, params.id)
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [history, { plans }] = await Promise.all([loadChangeHistory(ctx.admin, ctx.orgId, { templateId: t.id }), loadServicePlans(ctx.admin, ctx.orgId, { templateId: t.id })])
  const live = plans.filter((p) => p.status !== 'ended')
  return NextResponse.json({ template: t, history, plans: live.length, behind: live.filter((p) => (p.template_version ?? 0) < t.version).length })
}

/** PATCH — edit a template (owners). Plans already sold keep their copy; push changes with …/apply. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  const r = await saveTemplate(ctx.admin, ctx.orgId, ctx.userId, params.id, await request.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ template: r.template })
}
