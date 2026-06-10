import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole, isRegionalBonusApproverRole } from '@/lib/payroll-admin-access'
import { isUserInManagerHierarchy } from '@/lib/payroll-statement-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type BonusStatus = 'pending_approval' | 'approved' | 'rejected' | 'paid'

// 'paid' is restricted to full payroll admins only (not regional approvers) — see below
const ALLOWED_STATUSES = new Set<BonusStatus>(['pending_approval', 'approved', 'rejected', 'paid'])

// Valid status transitions — prevents illegal state machine jumps (e.g., paid → pending)
const ALLOWED_TRANSITIONS: Record<BonusStatus, BonusStatus[]> = {
  pending_approval: ['approved', 'rejected'],
  approved: ['rejected', 'paid'],
  rejected: ['pending_approval', 'approved'],
  paid: [], // terminal state — no transitions out
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { bonusLineId: string } },
) {
  try {
    let profile
    let actorUserId: string
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
      actorUserId = ctx.authUser.id
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Quick role check — must be payroll admin OR a regional approver role
    const isFullAdmin = isPayrollAdminRole(profile.role)
    const isRegionalApprover = isRegionalBonusApproverRole(profile.role)
    if (!isFullAdmin && !isRegionalApprover) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json().catch(() => null)) as {
      status?: string
      action?: string
      note?: string | null
    } | null
    const requestedStatus = body?.status ?? body?.action
    const status = requestedStatus === 'approve'
      ? 'approved'
      : requestedStatus === 'reject'
      ? 'rejected'
      : requestedStatus === 'pending'
      ? 'pending_approval'
      : requestedStatus === 'mark_paid'
      ? 'paid'
      : requestedStatus

    if (!status || !ALLOWED_STATUSES.has(status as BonusStatus)) {
      return NextResponse.json(
        { error: 'status must be pending_approval, approved, rejected, or paid' },
        { status: 400 },
      )
    }

    // Only full payroll admins can mark a line as paid — regional approvers cannot
    if (status === 'paid' && !isFullAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const note = typeof body?.note === 'string' ? body.note.trim() : null
    const supabase = createServiceClient()

    // Fetch bonus line — include status so we can enforce the state machine
    const { data: bonusLine, error: loadError } = await supabase
      .from('payroll_bonus_lines')
      .select('id, org_id, payroll_period_id, user_id, status')
      .eq('id', params.bonusLineId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 })
    }
    if (!bonusLine) {
      return NextResponse.json({ error: 'Bonus line not found' }, { status: 404 })
    }

    // Regional approvers may only approve bonuses for reps in their manager hierarchy
    if (!isFullAdmin && isRegionalApprover) {
      const inHierarchy = await isUserInManagerHierarchy(
        supabase,
        profile.org_id,
        actorUserId,
        bonusLine.user_id,
      )
      if (!inHierarchy) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Enforce state machine — reject illegal transitions before touching the DB
    const currentStatus = bonusLine.status as BonusStatus
    const allowedNext = ALLOWED_TRANSITIONS[currentStatus] ?? []
    if (!allowedNext.includes(status as BonusStatus)) {
      return NextResponse.json(
        { error: `Cannot transition from '${currentStatus}' to '${status}'` },
        { status: 409 },
      )
    }

    const { data: period, error: periodError } = await supabase
      .from('payroll_periods')
      .select('id, status, locked_at, paid_at')
      .eq('id', bonusLine.payroll_period_id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (periodError) {
      return NextResponse.json({ error: periodError.message }, { status: 500 })
    }
    if (!period) {
      return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
    }
    // Marking a line as 'paid' is a confirmation that payment was delivered — this is
    // intentionally allowed after the period locks (that's the normal end-of-cycle flow).
    // All other status changes are blocked once the period is locked.
    const periodIsLocked = period.status === 'locked' || period.status === 'paid' || period.locked_at || period.paid_at
    if (periodIsLocked && status !== 'paid') {
      return NextResponse.json({ error: 'Payroll period is locked' }, { status: 409 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('payroll_bonus_lines')
      .update({
        status,
        reviewed_by: actorUserId,
        reviewed_at: new Date().toISOString(),
        review_note: note,
      })
      .eq('id', bonusLine.id)
      .eq('org_id', profile.org_id)
      .eq('status', currentStatus) // optimistic lock — prevents concurrent double-transitions
      .select('id, status, reviewed_at, review_note')
      .maybeSingle()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    if (!updated) {
      // 0 rows matched — a concurrent request already changed the status
      return NextResponse.json(
        { error: 'Bonus line status was changed by another request. Please refresh and try again.' },
        { status: 409 },
      )
    }

    return NextResponse.json({ bonus_line: updated })
  } catch (error) {
    console.error('PATCH admin/payroll bonus line status', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
