import { NextResponse } from 'next/server'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { buildCrewDaySheet } from '@/lib/crew-day-sheet'
import { generateCrewDaySheetPDF } from '@/lib/pdf/crew-day-sheet'
import { pdfResponse } from '@/lib/pdf-response'
import { isYmd, ymdInZone } from '@/lib/service-plans'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ops/visits/sheet?crew=<subId>&day=YYYY-MM-DD — the same "Today's sheet" PDF a crew prints from its phone link, for
 * one crew and day (default today), opened from the Visits board. Anyone who can view visits; amounts owed only for people
 * who see prices. Same builder and renderer as the crew link.
 */
export async function GET(request: Request) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const url = new URL(request.url)
  const subId = url.searchParams.get('crew') ?? ''
  if (!subId) return NextResponse.json({ error: 'Pick a crew' }, { status: 400 })
  const { data: sub } = await orgDb(ctx.admin, ctx.orgId).from('sub_contractors').select('id, company_name').eq('id', subId).maybeSingle()
  if (!sub) return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
  const dayParam = url.searchParams.get('day')
  const day = isYmd(dayParam) ? dayParam : ymdInZone(new Date(), await loadOrgTimeZone(ctx.admin, ctx.orgId))
  try {
    const crewName = (sub as { company_name: string | null }).company_name ?? 'Crew'
    const sheet = await buildCrewDaySheet(ctx.admin, ctx.orgId, { subId, crewName, day, money: ctx.access.prices })
    return pdfResponse(generateCrewDaySheetPDF(sheet), `Sheet ${crewName} ${day}.pdf`, url.searchParams.get('download') === '1')
  } catch (e) {
    console.error('[visits] sheet failed', e)
    return NextResponse.json({ error: 'Could not make the sheet' }, { status: 500 })
  }
}
