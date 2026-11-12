import { NextResponse } from 'next/server'

import { parseShapesInput } from '@/lib/area-measure'
import {
  AREA_MEASURE_NOT_READY,
  loadAreaMeasureSettings,
  loadAreaMeasurements,
  resolveAreaMeasureTarget,
  saveAreaMeasurement,
  type AreaMeasureRefs,
} from '@/lib/area-measure-db'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * GET ?customer_id= | property_id= | opportunity_id= | lead_id= — the saved measurements for that record, newest first
 * (`rows`; `latest` is the newest, with the plain lawn_sqft / bed_sqft / line_feet values a price-book size option would read).
 */
export async function GET(request: Request) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const off = await orgFeatureOffResponse(ctx.viewer.orgId, 'areaMeasure')
  if (off) return off
  const q = new URL(request.url).searchParams
  const refs: AreaMeasureRefs = { customerId: str(q.get('customer_id')), propertyId: str(q.get('property_id')), opportunityId: str(q.get('opportunity_id')), leadId: str(q.get('lead_id')) }
  const t = await resolveAreaMeasureTarget(ctx.admin, ctx.viewer, refs)
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status })
  const [{ ready, rows }, settings] = await Promise.all([
    loadAreaMeasurements(ctx.admin, ctx.viewer.orgId, t.target),
    loadAreaMeasureSettings(ctx.admin, ctx.viewer.orgId),
  ])
  return NextResponse.json({ ready, rows, latest: rows[0] ?? null, settings, canWrite: t.target.canWrite })
}

/**
 * POST — save a measurement as a NEW row (older ones stay). body: { customerId?, propertyId?, opportunityId?, leadId?,
 * address?, lat?, lng?, shapes[] }. At least one record must be named; every id is checked against the caller's company and
 * what they may open; the totals are recomputed here from the shapes and the company's own settings.
 */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const off = await orgFeatureOffResponse(ctx.viewer.orgId, 'areaMeasure')
  if (off) return off
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const t = await resolveAreaMeasureTarget(ctx.admin, ctx.viewer, {
    customerId: str(body.customerId),
    propertyId: str(body.propertyId),
    opportunityId: str(body.opportunityId),
    leadId: str(body.leadId),
  })
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status })
  if (!t.target.canWrite) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = parseShapesInput(body.shapes)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) && Math.abs(body.lat) <= 90 ? body.lat : null
  const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) && Math.abs(body.lng) <= 180 ? body.lng : null
  const saved = await saveAreaMeasurement(ctx.admin, ctx.viewer.orgId, {
    target: t.target,
    shapes: parsed.shapes,
    address: str(body.address) ?? t.target.address,
    lat,
    lng,
    createdBy: ctx.profile.id,
  })
  if (!saved.ok) return NextResponse.json({ error: saved.status === 503 ? AREA_MEASURE_NOT_READY : saved.error }, { status: saved.status })
  return NextResponse.json({ measurement: saved.row }, { status: 201 })
}
