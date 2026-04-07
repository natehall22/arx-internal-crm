import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const MANAGER_ROLES = ['admin', 'sales_manager', 'setter_manager', 'regional_manager']

function isManager(role: string) {
  return MANAGER_ROLES.includes(role)
}

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const userId = request.nextUrl.searchParams.get('userId') || profile.id

    // Non-managers can only read their own goals
    if (userId !== profile.id && !isManager(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: goals } = await supabase
      .from('coaching_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    // Also fetch the user's comp plan for commission rate pre-fill
    const { data: userCompPlan } = await supabase
      .from('user_comp_plans')
      .select('override_percentage, comp_plans(plan_type, base_percentage, flat_amount, flat_rate)')
      .eq('user_id', userId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    const plan = Array.isArray(userCompPlan?.comp_plans)
      ? (userCompPlan!.comp_plans as any[])[0]
      : userCompPlan?.comp_plans as any
    let commissionRate: number | null = null
    if (plan?.plan_type === 'percentage' || plan?.base_percentage) {
      commissionRate = userCompPlan?.override_percentage ?? plan?.base_percentage ?? null
    }

    return NextResponse.json({ goals: goals || null, commissionRate })
  } catch (error) {
    console.error('[coaching/goals GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const body = await request.json()
    const { userId, ...goalFields } = body

    const targetUserId = userId || profile.id

    // Non-managers can only edit their own goals
    if (targetUserId !== profile.id && !isManager(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const payload = {
      org_id: profile.org_id,
      user_id: targetUserId,
      annual_income_goal: goalFields.annual_income_goal ?? null,
      avg_deal_value: goalFields.avg_deal_value ?? null,
      working_days_per_week: goalFields.working_days_per_week ?? 5,
      working_weeks_per_year: goalFields.working_weeks_per_year ?? 50,
      close_rate_override: goalFields.close_rate_override ?? null,
      stick_rate_override: goalFields.stick_rate_override ?? null,
      commission_rate_override: goalFields.commission_rate_override ?? null,
      updated_by: targetUserId !== profile.id ? profile.id : null,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('coaching_goals')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) {
      console.error('[coaching/goals PUT]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ goals: data })
  } catch (error) {
    console.error('[coaching/goals PUT]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
