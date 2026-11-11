import { NextResponse } from 'next/server'

import { isOrgFeatureOn } from '@/lib/org-features-server'
import { activeCrewDay } from '@/lib/service-plans-access'
import { createServiceClient } from '@/lib/supabase/service'
import { parseClockTap } from '@/lib/time-tracking'
import { applyClockTap, loadClockState, type ClockActor } from '@/lib/time-tracking-db'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, private' }

/** The crew this phone link is for, when the company uses the time clock. Null = no clock (a sub, a dead link, switch off). */
async function crewActor(token: string): Promise<{ admin: ReturnType<typeof createServiceClient>; actor: ClockActor } | null> {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, token)
  if (!crew || !(await isOrgFeatureOn(crew.orgId, 'timeTracking'))) return null
  return { admin, actor: { via: 'crew_link', orgId: crew.orgId, subId: crew.subId } }
}

/** GET — who on this crew is clocked in, lunch, machines running, and any "what time did you finish?" questions. */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const c = await crewActor(params.token)
  if (!c) return NextResponse.json({ error: 'No time clock on this link' }, { status: 404, headers: noStore })
  return NextResponse.json(await loadClockState(c.admin, c.actor), { headers: noStore })
}

/**
 * POST — one tap from the crew phone (public: the link is the key). Taps may arrive late from the phone's offline
 * queue; each carries its own id so a resend changes nothing. 4xx with `permanent: true` = don't retry.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const c = await crewActor(params.token)
  if (!c) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.', permanent: true }, { status: 404, headers: noStore })
  const parsed = parseClockTap(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, permanent: true }, { status: 400, headers: noStore })
  const res = await applyClockTap(c.admin, c.actor, parsed.tap)
  if (!res.ok) return NextResponse.json({ error: res.error, permanent: res.permanent ?? false }, { status: res.status, headers: noStore })
  return NextResponse.json({ ok: true, done: res.done }, { headers: noStore })
}
