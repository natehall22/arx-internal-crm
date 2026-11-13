import { NextResponse } from 'next/server'

import { activeCrewDay } from '@/lib/service-plans-access'
import { loadCrewVisit } from '@/lib/service-plans-db'
import { createServiceClient } from '@/lib/supabase/service'
import { tapVisitChecklist } from '@/lib/visit-checklist-db'

export const dynamic = 'force-dynamic'

/**
 * POST { label, done } — public (the crew's phone link): check or uncheck one service on one of THIS crew's visits (today or
 * yesterday), while it is still to do. The label must be on the visit's list. Never touches price or status.
 */
export async function POST(request: Request, { params }: { params: { token: string; id: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const visit = await loadCrewVisit(admin, crew, params.id)
  if (!visit) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { label?: unknown; done?: unknown }
  const res = await tapVisitChecklist(admin, crew.orgId, crew.subId, visit.id, body.label, body.done)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, checklist: res.checklist })
}
