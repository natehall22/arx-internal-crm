import { NextResponse } from 'next/server'

import { CREW_VISIT_ACTIONS, parseVisitAction } from '@/lib/service-plans'
import { applyVisitAction, loadCrewVisit } from '@/lib/service-plans-db'
import { activeCrewDay } from '@/lib/service-plans-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/crew/day/[token]/visits/[id] — public (no session): the crew's phone link marks one of ITS visits from
 * yesterday or today done, or skipped with a reason. Never reopen / move / reassign (the office does those).
 */
export async function POST(request: Request, { params }: { params: { token: string; id: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const action = parseVisitAction(await request.json().catch(() => null))
  if ('error' in action) return NextResponse.json({ error: action.error }, { status: 400 })
  if (!CREW_VISIT_ACTIONS.includes(action.action)) return NextResponse.json({ error: 'Ask the office to change that' }, { status: 403 })
  const visit = await loadCrewVisit(admin, crew, params.id)
  if (!visit) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const res = await applyVisitAction(admin, crew.orgId, visit.id, action, { userId: null, subId: crew.subId }, { onlySubId: crew.subId })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
