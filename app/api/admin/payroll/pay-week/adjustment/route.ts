/**
 * POST   { periodId, userId, amount, reason, jobId? } — "Fix a mistake": a signed line on the viewed week if it is still
 *        open, otherwise on the NEXT week (a paid week never changes).
 * DELETE ?id= — remove a fix that is still on an open week.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { addAdjustment, voidAdjustment } from '@/lib/payroll-adjustments'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown; userId?: unknown; amount?: unknown; reason?: unknown; jobId?: unknown } | null
  const periodId = typeof body?.periodId === 'string' ? body.periodId : ''
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  const jobId = typeof body?.jobId === 'string' && UUID.test(body.jobId) ? body.jobId : null
  if (!UUID.test(periodId) || !UUID.test(userId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const res = await addAdjustment(a.admin, {
    orgId: a.profile.org_id,
    actorUserId: a.profile.id,
    viewedPeriodId: periodId,
    userId,
    amount: Number(body?.amount),
    reason: typeof body?.reason === 'string' ? body.reason : '',
    jobId,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, id: res.id, nextWeek: res.nextWeek })
}

export async function DELETE(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const res = await voidAdjustment(a.admin, a.profile.org_id, id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
