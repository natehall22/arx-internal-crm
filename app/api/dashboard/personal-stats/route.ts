import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getDateRangeForTimeFrame, getCustomDateRange } from '@/lib/date-ranges'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { isDashboardPersonalKpiOrgWide } from '@/lib/dashboard-personal-kpi-scope'
import { getContactDispositionIdSet } from '@/lib/sales-metrics'
import { fetchPeriodMetricRows, summarizePeriodRows } from '@/lib/reporting/period-metrics'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const timeframe = request.nextUrl.searchParams.get('timeframe') || 'week'
    const customStartDate = request.nextUrl.searchParams.get('startDate')
    const customEndDate = request.nextUrl.searchParams.get('endDate')
    const { start, end } =
      timeframe === 'custom' && customStartDate && customEndDate
        ? getCustomDateRange(customStartDate, customEndDate, TIMEZONE)
        : getDateRangeForTimeFrame(timeframe, TIMEZONE, false)

    const isSetter = isSetterLikeRole(profile.role)
    const orgWideKpis = isDashboardPersonalKpiOrgWide(profile.role)
    // Empty scope = whole org in dashboard_*_scoped RPCs; reps see only their id.
    const scopeForRpc = orgWideKpis ? [] : [profile.id]

    const { data: orgRow } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const contactDispositionIdSet = getContactDispositionIdSet(
      orgRow?.settings?.canvass_dispositions as any[] | undefined
    )

    // Everything below comes from the reporting views — the same rows the Dashboard page, the leaderboard
    // and /reports use — so the number cannot change between first paint and this refetch.
    const rows = await fetchPeriodMetricRows(supabase, {
      orgId: profile.org_id,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    })
    const stats = summarizePeriodRows(rows, orgWideKpis ? null : new Set([profile.id]), {
      setterLane: isSetter,
      contactDispositionIdSet,
    })
    const { doors: doorsKnocked, contacts, inspectionsSet, sits, sales, calendar: apptCount } = stats

    const closeRate = sits > 0 ? parseFloat(((sales / sits) * 100).toFixed(1)) : null
    const efficiency = apptCount > 0 ? parseFloat(((sales / apptCount) * 100).toFixed(1)) : null

    return NextResponse.json({
      doorsKnocked,
      contacts,
      inspectionsSet,
      sits,
      sales,
      closeRate,
      efficiency,
    })
  } catch (error) {
    console.error('Personal stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch personal stats' }, { status: 500 })
  }
}
