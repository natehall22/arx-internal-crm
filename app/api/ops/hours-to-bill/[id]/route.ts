import { NextResponse } from 'next/server'

import { hourlyRouteAuth } from '@/lib/hourly-billing-access'
import { unapproveHours } from '@/lib/hourly-billing-db'
import { isUuidLike } from '@/lib/time-tracking'

export const dynamic = 'force-dynamic'

/** DELETE /api/ops/hours-to-bill/<approval id> { reason } — un-approve a day whose invoice is void (so it can be billed again). */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const ctx = await hourlyRouteAuth('bill')
  if (ctx instanceof Response) return ctx
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  const result = await unapproveHours(ctx.admin, ctx.orgId, ctx.userId, params.id, typeof body?.reason === 'string' ? body.reason : '')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
