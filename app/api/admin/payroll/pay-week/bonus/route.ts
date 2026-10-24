/**
 * POST { id, periodId, action: 'approve' } — approve a pending bonus onto the open week `periodId` (moving it there if the
 * sync dropped it into an earlier approved week). "Not now" needs no call: an unapproved bonus stays pending and shows on
 * the next open week. Full payroll admins only (regional approvers keep their hub).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { isUuid } from '@/lib/payroll-pay-week'
import { isPeriodClaimedError, periodRefusalMessage } from '@/lib/payroll-periods'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown; periodId?: unknown } | null
  if (!isUuid(body?.id) || !isUuid(body?.periodId) || body?.action !== 'approve') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const id = body.id as string
  const openPeriodId = body.periodId as string
  const orgId = a.profile.org_id

  // The week being worked on must be open.
  const { data: open } = await a.admin.from('payroll_periods').select('status, locked_at').eq('id', openPeriodId).eq('org_id', orgId).maybeSingle()
  if (!open || open.status !== 'open' || open.locked_at) return NextResponse.json({ error: 'This week is already approved' }, { status: 409 })

  const { data: line } = await a.admin.from('payroll_bonus_lines').select('id, payroll_period_id, status').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!line) return NextResponse.json({ error: 'Bonus not found' }, { status: 404 })
  if (line.status !== 'pending_approval') return NextResponse.json({ error: 'This bonus was already handled' }, { status: 409 })

  // A bonus dropped into an earlier, already-approved week can't be paid there: it moves onto the open week as it is approved.
  const patch: Record<string, unknown> = { status: 'approved', reviewed_by: a.profile.id, reviewed_at: new Date().toISOString(), review_note: 'Approved on Pay this week' }
  if (line.payroll_period_id !== openPeriodId) {
    const { data: from } = await a.admin.from('payroll_periods').select('status').eq('id', line.payroll_period_id as string).eq('org_id', orgId).maybeSingle()
    if (from?.status === 'open') return NextResponse.json({ error: 'That bonus belongs to a different open week' }, { status: 409 })
    patch.payroll_period_id = openPeriodId
  }
  const { data: updated, error } = await a.admin.from('payroll_bonus_lines').update(patch).eq('id', id).eq('org_id', orgId).eq('status', 'pending_approval').select('id').maybeSingle()
  if (isPeriodClaimedError(error)) return NextResponse.json({ error: periodRefusalMessage(error) }, { status: 409 })
  if (error) {
    // Unique (week, person, type): this person already has a bonus of that type this week.
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'This person already has a bonus of that kind this week.' }, { status: 409 })
    return NextResponse.json({ error: 'Could not approve the bonus' }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'This bonus was changed by someone else. Refresh.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
