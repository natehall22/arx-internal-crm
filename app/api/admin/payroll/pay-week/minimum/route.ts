/**
 * POST { periodId, userId, met } — the office's answer for one person's weekly minimum this week ("Did they meet this week's
 * requirements?"). Yes pays the top-up on this check; No pays commission only. Payroll admins (the office prepares; owners approve).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'
import { isUuid } from '@/lib/payroll-pay-week'
import { isPeriodClaimedError, periodRefusalMessage } from '@/lib/payroll-periods'
import { saveMinimumDecision } from '@/lib/payroll-weekly-minimum'
import { isMissingTable } from '@/lib/supabase/errors'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { periodId?: unknown; userId?: unknown; met?: unknown } | null
  if (!isUuid(body?.periodId) || !isUuid(body?.userId) || typeof body?.met !== 'boolean') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const orgId = a.profile.org_id
  const { data: period } = await a.admin.from('payroll_periods').select('id, status').eq('id', body.periodId as string).eq('org_id', orgId).maybeSingle()
  if (!period) return NextResponse.json({ error: 'Week not found' }, { status: 404 })
  if (period.status !== 'open') return NextResponse.json({ error: 'This week is already approved' }, { status: 409 })
  const { data: person } = await a.admin.from('users').select('id').eq('id', body.userId as string).eq('org_id', orgId).maybeSingle()
  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 })

  const { error } = await saveMinimumDecision(a.admin, { orgId, periodId: body.periodId as string, userId: body.userId as string, met: body.met, actorUserId: a.profile.id })
  if (isPeriodClaimedError(error)) return NextResponse.json({ error: periodRefusalMessage(error) }, { status: 409 })
  if (error && isMissingTable(error)) return NextResponse.json({ error: 'Weekly minimums need the database update first.', code: 'needs_migration' }, { status: 503 })
  if (error) {
    console.error('pay-week minimum', error)
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
