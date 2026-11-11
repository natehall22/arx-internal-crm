import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { applyTemplateToPlans } from '@/lib/service-plans-db'

export const dynamic = 'force-dynamic'

/**
 * POST { preview: boolean } — push this template's current version to the plans sold from it that are on an older
 * version (owners). Preview first: how many plans, and how many upcoming visits are removed / added / updated.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  const body = ((await request.json().catch(() => null)) ?? {}) as { preview?: unknown }
  const r = await applyTemplateToPlans(ctx.admin, ctx.orgId, ctx.userId, params.id, { preview: body.preview !== false })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
