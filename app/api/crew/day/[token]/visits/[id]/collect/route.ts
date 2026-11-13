import { NextResponse } from 'next/server'

import { activeCrewDay } from '@/lib/service-plans-access'
import { loadCrewVisit } from '@/lib/service-plans-db'
import { createServiceClient } from '@/lib/supabase/service'
import { cleanCollectionInput } from '@/lib/visit-collections'
import { loadCrewMoney, recordPendingCollection } from '@/lib/visit-collections-db'

export const dynamic = 'force-dynamic'

/**
 * POST { amount, method: 'cash' | 'check', checkNumber?, note?, tapId? } — public (the crew's phone link): the crew writes down
 * cash or a check it took at THIS visit. It is only a PENDING record for the office to confirm — it changes no balance and
 * records no payment. Not more than the customer still owes. Returns what the customer owes now.
 */
export async function POST(request: Request, { params }: { params: { token: string; id: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const visit = await loadCrewVisit(admin, crew, params.id)
  if (!visit || !visit.customerId) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const input = cleanCollectionInput(await request.json().catch(() => null))
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })
  const res = await recordPendingCollection(admin, crew.orgId, { subId: crew.subId, visitId: visit.id, customerId: visit.customerId, input: input.value })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  const money = (await loadCrewMoney(admin, crew.orgId, [{ id: visit.id, customerId: visit.customerId }]))[visit.id] ?? { dueCents: 0, pendingCents: 0, canPayOnline: false }
  return NextResponse.json({ ok: true, money })
}
