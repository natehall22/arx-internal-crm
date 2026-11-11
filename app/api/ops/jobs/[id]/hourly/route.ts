import { NextResponse } from 'next/server'

import { hourlyRouteAuth } from '@/lib/hourly-billing-access'
import { loadJobHourlySetup, parseJobHourlyPatch, saveJobHourlySetup } from '@/lib/hourly-billing-db'
import { isUuidLike } from '@/lib/time-tracking'

export const dynamic = 'force-dynamic'

/** GET — how this job is billed (as sold / by the hour), its estimate, labor rate, what its quote says, hours billed. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await hourlyRouteAuth('viewJob')
  if (ctx instanceof Response) return ctx
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await loadJobHourlySetup(ctx.admin, ctx.orgId, params.id)
  if ('ok' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ...r, canEdit: ctx.access.editJob, canBill: ctx.access.bill })
}

/** PATCH { mode: 'fixed'|'time_materials', estimatedHours?, rateItemId? } — jobs:edit. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await hourlyRouteAuth('editJob')
  if (ctx instanceof Response) return ctx
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = parseJobHourlyPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const r = await saveJobHourlySetup(ctx.admin, ctx.orgId, params.id, parsed.patch)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  const fresh = await loadJobHourlySetup(ctx.admin, ctx.orgId, params.id)
  return NextResponse.json('ok' in fresh ? { ok: true } : { ok: true, ...fresh, canEdit: true, canBill: ctx.access.bill })
}
