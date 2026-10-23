/** POST { id, action: 'reply'|'fix', reply?, periodId?, amount? } — answer a rep's "Something's wrong?". */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { resolveDispute } from '@/lib/payroll-disputes'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown; reply?: unknown; periodId?: unknown; amount?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!/^[0-9a-f-]{36}$/i.test(id) || (body?.action !== 'reply' && body?.action !== 'fix')) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const res = await resolveDispute(a.admin, {
    orgId: a.profile.org_id,
    actorUserId: a.profile.id,
    id,
    action: body.action,
    reply: typeof body.reply === 'string' ? body.reply : undefined,
    viewedPeriodId: typeof body.periodId === 'string' && /^[0-9a-f-]{36}$/i.test(body.periodId) ? body.periodId : undefined,
    amount: body.amount == null ? undefined : Number(body.amount),
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
