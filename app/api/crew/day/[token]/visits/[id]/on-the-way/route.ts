import { NextResponse } from 'next/server'

import { notifyVisitOnTheWay } from '@/lib/customer-messages-db'
import { loadCrewVisit } from '@/lib/service-plans-db'
import { activeCrewDay } from '@/lib/service-plans-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const SAID: Record<string, string> = {
  sent: 'Customer told you’re on the way',
  already: 'Customer was already told',
  queued: 'Customer will be told in a moment',
  deferred: 'Customer will be told in a moment',
  failed: 'Couldn’t email the customer — we’ll try again',
  skipped: 'This customer doesn’t get emails',
  cancelled: 'This visit is already closed',
  not_today: 'Only for today’s visits',
  off: 'On-the-way emails are off',
  not_ready: 'On-the-way emails are off',
}

/**
 * POST /api/crew/day/[token]/visits/[id]/on-the-way — public (the crew's phone link IS the key): tell the customer the
 * crew is coming (lib/customer-messages-db.ts `notifyVisitOnTheWay`; once per visit per day, a second tap is a no-op).
 * Only this crew's visits, only today's, only while the company has the "on the way" email on.
 */
export async function POST(_request: Request, { params }: { params: { token: string; id: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const visit = await loadCrewVisit(admin, crew, params.id)
  if (!visit) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const r = await notifyVisitOnTheWay(admin, crew.orgId, visit.id)
  const ok = r.status === 'sent' || r.status === 'already' || r.status === 'queued' || r.status === 'deferred' || r.status === 'skipped'
  return NextResponse.json({ ok, status: r.status, message: SAID[r.status] ?? 'Done' }, { status: ok ? 200 : r.status === 'failed' ? 502 : 409 })
}
