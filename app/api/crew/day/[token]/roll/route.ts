import { NextResponse } from 'next/server'

import { loadCrewProjectStops } from '@/lib/crew-day-projects'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { ymdInZone } from '@/lib/service-plans'
import { activeCrewDay } from '@/lib/service-plans-access'
import { loadCrewVisit } from '@/lib/service-plans-db'
import { createServiceClient } from '@/lib/supabase/service'
import { rollWorkOrder } from '@/lib/work-order-roll'
import { parseRollReason } from '@/lib/work-order-rolls'

export const dynamic = 'force-dynamic'

/**
 * POST /api/crew/day/[token]/roll  { id, reason? } — public (no session): the crew's phone link taps "Not ready — roll" on ONE of
 * its own stops from yesterday or today (a visit, or a project stop). It lands on the crew's next working day; the office sees
 * "Rolled N×" and the reason. A crew can roll its own work forward only — nothing else about the schedule.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { id?: unknown; reason?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Pick the stop' }, { status: 400 })
  const reason = parseRollReason(body?.reason)
  if (reason && typeof reason === 'object') return NextResponse.json(reason, { status: 400 })
  // The stop must be one this link shows: one of its visits (yesterday / today), or a project stop of today.
  const visit = await loadCrewVisit(admin, crew, id)
  if (!visit) {
    const today = ymdInZone(new Date(), await loadOrgTimeZone(admin, crew.orgId))
    const stops = await loadCrewProjectStops(admin, { orgId: crew.orgId, subId: crew.subId }, today).catch(() => [])
    if (!stops.some((s) => s.id === id)) return NextResponse.json({ error: 'Stop not found' }, { status: 404 })
  }
  const res = await rollWorkOrder(admin, crew.orgId, id, { reason, by: { userId: null, subId: crew.subId }, schedulingUserId: '', onlySubId: crew.subId })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, to: res.to, rolls: res.rolls })
}
