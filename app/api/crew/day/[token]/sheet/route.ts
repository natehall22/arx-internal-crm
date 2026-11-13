import { NextResponse } from 'next/server'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { buildCrewDaySheet } from '@/lib/crew-day-sheet'
import { generateCrewDaySheetPDF } from '@/lib/pdf/crew-day-sheet'
import { pdfResponse } from '@/lib/pdf-response'
import { ymdInZone } from '@/lib/service-plans'
import { activeCrewDay } from '@/lib/service-plans-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET — public (the crew's phone link): "Print today's sheet". THIS crew's visits for today, in stop order, as a PDF. Same
 * builder and renderer as the staff Visits board (lib/crew-day-sheet.ts); no prices, no customer phone or email.
 */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  try {
    const day = ymdInZone(new Date(), await loadOrgTimeZone(admin, crew.orgId))
    const sheet = await buildCrewDaySheet(admin, crew.orgId, { subId: crew.subId, crewName: crew.crewName, day, money: true })
    return pdfResponse(generateCrewDaySheetPDF(sheet), `Today's sheet ${day}.pdf`)
  } catch (e) {
    console.error('[crew-day] sheet failed', e)
    return NextResponse.json({ error: 'Could not make the sheet. Try again.' }, { status: 500 })
  }
}
