/**
 * POST { periodId, expectedTotal } — Approve this week.
 * The caller sends the total it was shown; if the live calculation no longer equals it, nothing is paid and the screen
 * reloads (409 "changed"). Statements are emailed by a separate call (pay-week/email) so a slow mail server can't hang
 * or fail the approval.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { approvePayWeek } from '@/lib/payroll-approve'
import { isUuid } from '@/lib/payroll-pay-week'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown; expectedTotal?: unknown } | null
  const expected = Number(body?.expectedTotal)
  if (!isUuid(body?.periodId) || !Number.isFinite(expected)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  try {
    const result = await approvePayWeek(a.admin, { orgId: a.profile.org_id, actorUserId: a.profile.id, periodId: body.periodId as string, expectedTotal: expected })
    if (!result.ok) return NextResponse.json(result.body, { status: result.status })
    return NextResponse.json({ ok: true, total: result.total, people: result.people, message: result.message })
  } catch (e) {
    if ((e as Error).message === 'Pay period not found') return NextResponse.json({ error: 'Week not found' }, { status: 404 })
    console.error('POST pay-week approve', e)
    return NextResponse.json({ error: 'Could not approve. Nothing was paid; refresh and try again.' }, { status: 500 })
  }
}
