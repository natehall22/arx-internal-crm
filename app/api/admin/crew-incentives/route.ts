import { NextResponse } from 'next/server'

import { CREW_INCENTIVES_SETTINGS_KEY, parseCrewIncentivesPatch } from '@/lib/crew-incentives'
import { crewIncentivesRouteAuth } from '@/lib/crew-incentives-access'
import { loadCrewIncentivesState } from '@/lib/crew-incentives-db'
import { mergeOrgSettings } from '@/lib/org-settings'

export const dynamic = 'force-dynamic'

/** GET — the company's crew incentive rules (owners; lawn_landscape companies only). */
export async function GET() {
  const ctx = await crewIncentivesRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  return NextResponse.json({ settings: ctx.state.settings })
}

/** PATCH { crewIncentives: { enabled?, doneRight?, beatTime?, review?, weeklyTarget?, deduction? } } — owners. */
export async function PATCH(request: Request) {
  const ctx = await crewIncentivesRouteAuth('owner')
  if (ctx instanceof Response) return ctx
  const parsed = parseCrewIncentivesPatch(await request.json().catch(() => null), ctx.state.settings)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await mergeOrgSettings(ctx.admin, ctx.orgId, parsed.set, { path: [CREW_INCENTIVES_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, settings: (await loadCrewIncentivesState(ctx.admin, ctx.orgId)).settings })
}
