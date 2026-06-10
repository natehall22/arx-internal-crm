import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { isUserInManagerHierarchy } from '@/lib/payroll-statement-access'

export const dynamic = 'force-dynamic'

// Full admins can set goals for any rep in the org.
// All other manager-tier roles can only set goals for reps in their hierarchy.
const ADMIN_ROLES = new Set([
  'admin', 'owner', 'regional_manager', 'regional_setter_manager',
  'sales_manager', 'setter_manager', 'manager', 'operations',
])

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.has(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body.user_id !== 'string') {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  const {
    user_id,
    weekly_doors_target,
    weekly_inspections_target,
    weekly_sales_target,
    weekly_revenue_target,
    change_note,
  } = body as {
    user_id: string
    weekly_doors_target?: number | null
    weekly_inspections_target?: number | null
    weekly_sales_target?: number | null
    weekly_revenue_target?: number | null
    change_note?: string | null
  }

  // Verify the target user belongs to the same org
  const { data: targetUser } = await admin
    .from('users')
    .select('id')
    .eq('id', user_id)
    .eq('org_id', profile.org_id)
    .single()

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Non-full-admin roles (setter_manager, sales_manager, manager, etc.) may only
  // set goals for reps within their manager hierarchy — not org-wide.
  if (!isPayrollAdminRole(profile.role)) {
    const inHierarchy = await isUserInManagerHierarchy(
      admin,
      profile.org_id,
      user.id,
      user_id,
    )
    if (!inHierarchy) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10)

  // Fetch the current active goal so we can merge — prevents a partial update
  // (e.g., only changing sales_target) from wiping unrelated fields to null.
  const { data: existingGoal } = await admin
    .from('user_incentive_goals')
    .select('weekly_doors_target, weekly_inspections_target, weekly_sales_target, weekly_revenue_target')
    .eq('user_id', user_id)
    .eq('org_id', profile.org_id)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  const mergedDoors = weekly_doors_target !== undefined ? (weekly_doors_target ?? null) : (existingGoal?.weekly_doors_target ?? null)
  const mergedInspections = weekly_inspections_target !== undefined ? (weekly_inspections_target ?? null) : (existingGoal?.weekly_inspections_target ?? null)
  const mergedSales = weekly_sales_target !== undefined ? (weekly_sales_target ?? null) : (existingGoal?.weekly_sales_target ?? null)
  const mergedRevenue = weekly_revenue_target !== undefined ? (weekly_revenue_target ?? null) : (existingGoal?.weekly_revenue_target ?? null)

  const { error: historyError } = await admin
    .from('user_incentive_goals_history')
    .insert({
      org_id: profile.org_id,
      user_id,
      changed_by: user.id,
      weekly_doors_target: mergedDoors,
      weekly_inspections_target: mergedInspections,
      weekly_sales_target: mergedSales,
      weekly_revenue_target: mergedRevenue,
      effective_from: todayIso,
      change_note: change_note ?? null,
    })

  if (historyError) {
    console.error('Failed to write user incentive goal history:', historyError.message)
  }

  const { error: upsertError } = await admin
    .from('user_incentive_goals')
    .upsert(
      {
        org_id: profile.org_id,
        user_id,
        weekly_doors_target: mergedDoors,
        weekly_inspections_target: mergedInspections,
        weekly_sales_target: mergedSales,
        weekly_revenue_target: mergedRevenue,
        effective_from: todayIso,
        set_by: user.id,
      },
      { onConflict: 'user_id,effective_from' }
    )

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
