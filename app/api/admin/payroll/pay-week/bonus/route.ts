/**
 * POST { id, action: 'approve' } — approve a pending bonus onto this week's check. "Not now" needs no call: an unapproved
 * bonus rolls to next week when this week is approved. Full payroll admins only (regional approvers keep their hub).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requirePayrollAdminApi } from '@/lib/payroll-admin-api'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const a = await requirePayrollAdminApi()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!/^[0-9a-f-]{36}$/i.test(id) || body?.action !== 'approve') return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const { data: line } = await a.admin.from('payroll_bonus_lines').select('id, payroll_period_id, status').eq('id', id).eq('org_id', a.profile.org_id).maybeSingle()
  if (!line) return NextResponse.json({ error: 'Bonus not found' }, { status: 404 })
  const { data: period } = await a.admin.from('payroll_periods').select('status, locked_at').eq('id', line.payroll_period_id as string).eq('org_id', a.profile.org_id).maybeSingle()
  if (!period || period.status !== 'open' || period.locked_at) return NextResponse.json({ error: 'This week is already approved' }, { status: 409 })
  if (line.status !== 'pending_approval') return NextResponse.json({ error: 'This bonus was already handled' }, { status: 409 })

  const { data: updated, error } = await a.admin
    .from('payroll_bonus_lines')
    .update({ status: 'approved', reviewed_by: a.profile.id, reviewed_at: new Date().toISOString(), review_note: 'Approved on Pay this week' })
    .eq('id', id)
    .eq('org_id', a.profile.org_id)
    .eq('status', 'pending_approval') // optimistic lock
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not approve the bonus' }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'This bonus was changed by someone else. Refresh.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
