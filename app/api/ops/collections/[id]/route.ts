import { NextResponse } from 'next/server'

import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { confirmCollection, rejectCollection } from '@/lib/visit-collections-db'

export const dynamic = 'force-dynamic'

/**
 * POST { action: 'confirm' } | { action: 'reject', reason? } — the office decides on cash / a check a crew took at the door
 * (billing staff: the same people who record a payment). Confirm writes the real payments through the invoice payment writer;
 * reject writes nothing. Both are one-way and idempotent: a second tap says it was already handled.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const a = await requireOnlinePaymentsCaller('billing', request)
  if (a.error) return a.error
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; reason?: unknown }
  if (body.action !== 'confirm' && body.action !== 'reject') return NextResponse.json({ error: 'Confirm or reject' }, { status: 400 })
  const orgId = a.profile.org_id
  const res =
    body.action === 'confirm'
      ? await confirmCollection(a.admin, orgId, a.profile.id, params.id)
      : await rejectCollection(a.admin, orgId, a.profile.id, params.id, typeof body.reason === 'string' ? body.reason : null)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
