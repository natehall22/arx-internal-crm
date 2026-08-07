import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type OverlayLane = 'setter' | 'closer'

function isYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export async function POST(request: NextRequest) {
  try {
    let auth
    try {
      auth = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isPayrollAdminRole(auth.profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const userId = typeof body.user_id === 'string' ? body.user_id : ''
    const compPlanId = typeof body.comp_plan_id === 'string' ? body.comp_plan_id : ''
    const lane: OverlayLane | null =
      body.lane === 'setter' || body.lane === 'closer' ? body.lane : null
    const effectiveFrom = body.effective_from
    const reason = typeof body.change_reason === 'string' ? body.change_reason.trim() : ''

    if (!userId || !compPlanId || !lane || !isYmd(effectiveFrom)) {
      return NextResponse.json({ error: 'User, overlay plan, lane, and effective date are required.' }, { status: 400 })
    }
    if (!reason) {
      return NextResponse.json({ error: 'A change reason is required for payroll history.' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: plan, error: planError } = await supabase
      .from('comp_plans')
      .select('base_percentage')
      .eq('id', compPlanId)
      .eq('org_id', auth.profile.org_id)
      .eq('plan_purpose', 'management_overlay')
      .eq('is_active', true)
      .maybeSingle()
    const rate = Number(plan?.base_percentage)
    if (planError || !plan || plan.base_percentage == null || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      return NextResponse.json({ error: planError?.message || 'The selected overlay plan needs a valid fixed rate.' }, { status: 400 })
    }
    const { data, error } = await supabase.rpc('assign_management_comp_overlay', {
      p_org_id: auth.profile.org_id,
      p_user_id: userId,
      p_comp_plan_id: compPlanId,
      p_lane: lane,
      p_override_percent: rate,
      p_effective_from: effectiveFrom,
      p_created_by_user_id: auth.authUser.id,
      p_change_reason: reason,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ assignmentId: data }, { status: 201 })
  } catch (error) {
    console.error('management comp overlay assignment failed', error)
    return NextResponse.json({ error: 'Failed to assign management overlay.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuthApi().catch(() => null)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isPayrollAdminRole(auth.profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = (await request.json()) as Record<string, unknown>
    const assignmentId = typeof body.assignment_id === 'string' ? body.assignment_id : ''
    const effectiveTo = body.effective_to
    const reason = typeof body.change_reason === 'string' ? body.change_reason.trim() : ''
    if (!assignmentId || !isYmd(effectiveTo) || !reason) {
      return NextResponse.json({ error: 'Assignment, end date, and reason are required.' }, { status: 400 })
    }
    const supabase = createServiceClient()
    const { error } = await supabase.rpc('end_management_comp_overlay', {
      p_org_id: auth.profile.org_id,
      p_assignment_id: assignmentId,
      p_effective_to: effectiveTo,
      p_created_by_user_id: auth.authUser.id,
      p_change_reason: reason,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('management comp overlay end failed', error)
    return NextResponse.json({ error: 'Failed to end management overlay.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuthApi().catch(() => null)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isPayrollAdminRole(auth.profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = (await request.json()) as Record<string, unknown>
    const assignmentId = typeof body.assignment_id === 'string' ? body.assignment_id : ''
    const reason = typeof body.change_reason === 'string' ? body.change_reason.trim() : ''
    if (!assignmentId || !reason) {
      return NextResponse.json({ error: 'Assignment and cancellation reason are required.' }, { status: 400 })
    }
    const supabase = createServiceClient()
    const { error } = await supabase.rpc('cancel_management_comp_overlay', {
      p_org_id: auth.profile.org_id,
      p_assignment_id: assignmentId,
      p_created_by_user_id: auth.authUser.id,
      p_change_reason: reason,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('management comp overlay cancellation failed', error)
    return NextResponse.json({ error: 'Failed to cancel management overlay.' }, { status: 500 })
  }
}
