import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import {
  buildWeeklyCommissionsResponse,
  calendarWeekBounds,
} from '@/lib/payroll-dashboard-pay'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Dashboard pay summary: payroll estimate (open period) + optional last official locked net,
 * plus legacy calendar-week commissions (labeled separately).
 */
export async function GET(request: Request) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()
    const { id: userId, org_id: orgId } = profile

    const { weekStart, weekEnd } = calendarWeekBounds()

    const { data: userCompPlan } = await supabase
      .from('user_comp_plans')
      .select('id, comp_plans(is_active)')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .lte('effective_from', weekEnd)
      .or(`effective_to.is.null,effective_to.gte.${weekStart}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    const planRecord = userCompPlan?.comp_plans as { is_active?: boolean } | null
    let hasCompPlan = !!userCompPlan && planRecord?.is_active !== false
    if (!hasCompPlan) {
      const { data: defaultPlan } = await supabase
        .from('comp_plans')
        .select('id')
        .eq('org_id', orgId)
        .eq('is_default', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      hasCompPlan = !!defaultPlan
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
      new URL(request.url).origin

    const payload = await buildWeeklyCommissionsResponse({
      supabase,
      orgId,
      userId,
      hasCompPlan,
      appUrl,
    })

    return NextResponse.json(payload)
  } catch (e) {
    console.error('GET /api/commissions/weekly', e)
    return NextResponse.json({ error: 'Failed to fetch weekly commissions' }, { status: 500 })
  }
}
