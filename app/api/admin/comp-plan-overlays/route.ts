/**
 * Manager override (management comp overlay) assignment writes.
 *
 * An override line is not an org rate — payroll resolves it per manager, per production
 * lane, from the assignment created here plus the effective-dated plan version the RPC
 * writes alongside it. See lib/management-override-admin.ts for the read model.
 */

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

/** A management override above this is a typo, not a plan. Matches MAX_RATE in /api/admin/comp-rates. */
const MAX_OVERRIDE_RATE = 25

/**
 * The percent this assignment pays. An explicit value wins; otherwise the caller
 * supplies the rate already in force (the latest plan version on the effective date,
 * or the plan's base_percentage when this is the plan's first assignment).
 */
function resolveOverrideRate(
  raw: unknown,
  rateInForce: unknown
): { rate: number } | { error: string } {
  const provided = typeof raw === 'string' ? raw.trim() : raw
  const useCurrent = provided === undefined || provided === null || provided === ''
  const source = useCurrent ? rateInForce : provided
  if (source === undefined || source === null || source === '') {
    return { error: 'An override rate is required — the selected overlay plan has no rate yet.' }
  }
  const rate = Number(source)
  if (!Number.isFinite(rate)) return { error: 'Override rate must be a number' }
  if (rate < 0) return { error: 'Override rate cannot be negative' }
  if (rate > MAX_OVERRIDE_RATE) {
    return { error: `Override rate cannot exceed ${MAX_OVERRIDE_RATE}% — check for a typo` }
  }
  if (Math.round(rate * 100) !== rate * 100) {
    return { error: 'Override rate supports at most 2 decimal places (e.g. 1.00)' }
  }
  return { rate }
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
    if (planError || !plan) {
      return NextResponse.json({ error: planError?.message || 'Active management overlay plan not found.' }, { status: 400 })
    }

    // The rate may be set on the assignment itself. `assign_management_comp_overlay`
    // records it as a new effective-dated plan version, which is the only way to change
    // an overlay's percent at all: PUT /api/admin/data?resource=comp_plan 409s once a
    // plan carries any assignment, so the plan's own base_percentage is frozen from the
    // first assignment onward and can only ever be the STARTING default.
    //
    // So an omitted rate must fall back to the version in force on the effective date,
    // not to base_percentage. Falling back to the frozen plan value would let "leave it
    // blank to keep the current rate" quietly rewrite the rate for everyone on this
    // overlay plan and lane, back to whatever the plan was first created with.
    const { data: liveVersion, error: versionError } = await supabase
      .from('management_comp_overlay_plan_versions')
      .select('override_percent')
      .eq('org_id', auth.profile.org_id)
      .eq('comp_plan_id', compPlanId)
      .eq('lane', lane)
      .lte('effective_from', effectiveFrom)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (versionError) {
      console.error('management comp overlay (current version lookup)', versionError)
      return NextResponse.json({ error: 'Failed to read the current override rate.' }, { status: 500 })
    }

    const rateResult = resolveOverrideRate(
      body.override_percent,
      liveVersion?.override_percent ?? plan.base_percentage
    )
    if ('error' in rateResult) {
      return NextResponse.json({ error: rateResult.error }, { status: 400 })
    }
    const rate = rateResult.rate
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
