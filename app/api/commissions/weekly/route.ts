import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { isManagerSpoEligibleRole } from '@/lib/manager-commission-roles'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Closer lane — aligned with Sisu leaderboard. */
const CLOSER_ROLES = new Set(['closer', 'sales_rep', 'rep'])

type CommissionPerspectiveLane = 'setter' | 'closer' | 'manager' | 'other'

function resolveCommissionPerspectiveLane(role: string | null | undefined): CommissionPerspectiveLane {
  if (isSetterLikeRole(role)) return 'setter'
  if (role && CLOSER_ROLES.has(role)) return 'closer'
  if (isManagerSpoEligibleRole(role)) return 'manager'
  return 'other'
}

/** Live week-to-date commission total for the signed-in rep (iOS Sisu estimate card). */
export async function GET() {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const userId = profile.id
    const supabase = createServiceClient()

    const now = new Date()
    const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
    const [etYear, etMonth, etDay] = etDateStr.split('-').map(Number)
    const etDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now)
    )
    if (etDow < 0) throw new Error('Unable to compute ET day-of-week')
    const weekStartStr = new Date(Date.UTC(etYear, etMonth - 1, etDay - etDow)).toISOString().split('T')[0]
    const weekEndStr = new Date(Date.UTC(etYear, etMonth - 1, etDay - etDow + 6)).toISOString().split('T')[0]

    const { data: userCompPlan } = await supabase
      .from('user_comp_plans')
      .select('id, comp_plans(is_active)')
      .eq('user_id', userId)
      .eq('org_id', profile.org_id)
      .lte('effective_from', weekEndStr)
      .or(`effective_to.is.null,effective_to.gte.${weekStartStr}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    let hasCompPlan = !!userCompPlan && (userCompPlan.comp_plans as { is_active?: boolean } | null)?.is_active !== false
    if (!hasCompPlan) {
      const { data: defaultPlan } = await supabase
        .from('comp_plans')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      hasCompPlan = !!defaultPlan
    }

    const { data: commissions } = await supabase
      .from('commissions')
      .select('total_amount')
      .eq('user_id', userId)
      .gte('commission_period', weekStartStr)
      .lte('commission_period', weekEndStr)

    const weeklyTotal = commissions?.reduce((sum, c) => sum + (c.total_amount || 0), 0) || 0
    const role = profile.role ?? ''
    const perspectiveLane = resolveCommissionPerspectiveLane(role)

    return NextResponse.json({
      weeklyTotal,
      hasCompPlan,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      role,
      perspectiveLane,
      isEstimate: true,
    })
  } catch (error) {
    console.error('Weekly commissions error:', error)
    return NextResponse.json({ error: 'Failed to fetch weekly commissions' }, { status: 500 })
  }
}
