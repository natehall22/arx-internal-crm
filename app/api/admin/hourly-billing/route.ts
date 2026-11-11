import { NextResponse } from 'next/server'

import { HOURLY_BILLING_SETTINGS_KEY, parseHourlyBillingPatch } from '@/lib/hourly-billing'
import { hourlyRouteAuth } from '@/lib/hourly-billing-access'
import { loadHourlyOrgFacts, loadPriceItems } from '@/lib/hourly-billing-db'
import { mergeOrgSettings } from '@/lib/org-settings'

export const dynamic = 'force-dynamic'

async function view(admin: Parameters<typeof loadPriceItems>[0], orgId: string) {
  const [facts, items] = await Promise.all([loadHourlyOrgFacts(admin, orgId), loadPriceItems(admin, orgId)])
  const tripChoices = Array.from(items.values())
    .filter((i) => i.active && i.unit !== 'hour')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ id: i.id, name: i.name, rateCents: Math.round(i.unitPrice * 100) }))
  return { settings: facts.settings, tripChoices }
}

/** GET — the company's hourly billing rules (owners). */
export async function GET() {
  const ctx = await hourlyRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  return NextResponse.json(await view(ctx.admin, ctx.orgId))
}

/** PATCH { hourlyBilling: { rounding?, minimumHours?, travel?, tripChargeItemId?, basis?, equipmentFromOperator? } } — owners. */
export async function PATCH(request: Request) {
  const ctx = await hourlyRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  const parsed = parseHourlyBillingPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.set.tripChargeItemId) {
    const items = await loadPriceItems(ctx.admin, ctx.orgId)
    if (!items.has(parsed.set.tripChargeItemId)) return NextResponse.json({ error: 'Pick the trip charge from your price book' }, { status: 400 })
  }
  const { error } = await mergeOrgSettings(ctx.admin, ctx.orgId, parsed.set as Record<string, unknown>, { path: [HOURLY_BILLING_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, ...(await view(ctx.admin, ctx.orgId)) })
}
