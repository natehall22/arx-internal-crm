/** POST { periodId, userId, regularHours, overtimeHours? } — type a person's hours right on the Pay-this-week screen. */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { saveHoursEntries } from '@/lib/payroll-hours'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown; userId?: unknown; regularHours?: unknown; overtimeHours?: unknown } | null
  const periodId = typeof body?.periodId === 'string' ? body.periodId : ''
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  const reg = Number(body?.regularHours)
  const ot = Number(body?.overtimeHours ?? 0)
  if (!/^[0-9a-f-]{36}$/i.test(periodId) || !/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  if (!Number.isFinite(reg) || reg < 0 || reg > 120 || !Number.isFinite(ot) || ot < 0 || ot > 60) return NextResponse.json({ error: 'Hours must be between 0 and 120' }, { status: 400 })

  const { data: period } = await a.admin.from('payroll_periods').select('id, status, locked_at, cutoff_at').eq('id', periodId).eq('org_id', a.profile.org_id).maybeSingle()
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 })
  if (period.status !== 'open' || period.locked_at) return NextResponse.json({ error: 'This week is already approved' }, { status: 409 })

  const res = await saveHoursEntries(a.admin, {
    orgId: a.profile.org_id,
    periodId,
    cutoffAt: (period.cutoff_at as string) ?? null,
    actorUserId: a.profile.id,
    entries: [{ user_id: userId, regular_hours: reg, overtime_hours: ot, reason: 'Pay this week' }],
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
