import { NextResponse } from 'next/server'

import { mergeOrgSettings } from '@/lib/org-settings'
import { parseNightlyPatch, readNightlySettings, SCHEDULING_SETTINGS_KEY } from '@/lib/schedule-nightly'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { orgTimeZone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

async function view(admin: Parameters<typeof mergeOrgSettings>[0], orgId: string) {
  const { data } = await admin.from('orgs').select(`stored:settings->${SCHEDULING_SETTINGS_KEY}, timezone`).eq('id', orgId).maybeSingle()
  const row = (data ?? {}) as { stored?: unknown; timezone?: unknown }
  return { settings: readNightlySettings(row.stored), timeZone: orgTimeZone(row.timezone) }
}

/** GET — the company's nightly schedule settings (owners; service plans must be on). */
export async function GET() {
  const ctx = await servicePlanRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  return NextResponse.json(await view(ctx.admin, ctx.orgId))
}

/** PATCH { scheduling: { autoRoll?: { enabled, hour? }, endOfDay?: { enabled, hour? } } } — owners. A per-key merge at path ['scheduling']. */
export async function PATCH(request: Request) {
  const ctx = await servicePlanRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  const parsed = parseNightlyPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await mergeOrgSettings(ctx.admin, ctx.orgId, parsed.set as Record<string, unknown>, { path: [SCHEDULING_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, ...(await view(ctx.admin, ctx.orgId)) })
}
