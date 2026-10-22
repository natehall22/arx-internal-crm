import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getDateRangeForTimeFrame, getDateRangeWithDebug, getCustomDateRange } from '@/lib/date-ranges'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { resolveDashboardMemberScope } from '@/lib/dashboard-member-scope'
import { shouldShowUserOnTeamLeaderboard } from '@/lib/dashboard-team-leaderboard'
import { getContactDispositionIdSet } from '@/lib/sales-metrics'
import { fetchPeriodMetricRows, summarizePeriodRows } from '@/lib/reporting/period-metrics'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'

type TeamStatRow = {
  id: string
  name: string
  role: string
  doorsKnocked: number
  contacts: number
  inspectionsSet: number
  /** Appointments created in period with this user as assigned closer (reassignment moves credit). */
  inspectionsReceived: number
  sits: number
  sales: number
  closeRate: string
  efficiency: string
  _debug?: Record<string, number>
}

function getSessionFromRequest(req: NextRequest) {
  // Native iOS app sends Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return { access_token: authHeader.slice(7) }
  }

  // Web browser sends Supabase session cookie
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }

  if (chunks.length > 0) {
    try {
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role, team_id, region_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const timeframe = searchParams.get('timeframe') || 'week'
    const customStartDate = searchParams.get('startDate')
    const customEndDate = searchParams.get('endDate')
    const debug = searchParams.get('debug') === '1'
    const dateRange =
      timeframe === 'custom' && customStartDate && customEndDate
        ? getCustomDateRange(customStartDate, customEndDate, TIMEZONE)
        : debug
          ? getDateRangeWithDebug(timeframe, TIMEZONE)
          : getDateRangeForTimeFrame(timeframe, TIMEZONE, false)
    const { start, end } = dateRange
    
    // Debug logging for date range issues
    if (debug) {
      console.log('[team-stats] Date range:', {
        timeframe,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        nowUtc: new Date().toISOString(),
      })
    }

    // Who this viewer may see — shared with the Sisu leaderboard so the two
    // surfaces can never drift. See lib/dashboard-member-scope.ts.
    const scope = await resolveDashboardMemberScope(supabase, {
      id: user.id,
      org_id: profile.org_id,
      role: profile.role,
      team_id: profile.team_id,
      region_id: profile.region_id,
    })

    // Roster for RPC scope: everyone in org/team (including inactive and show_in_reports = false)
    // so pin-attributed doors/sits still roll up. We filter who appears in the UI after computing stats.
    let membersQuery = supabase
      .from('users')
      .select('id, full_name, role, show_in_reports, active')
      .eq('org_id', profile.org_id)

    if (!scope.orgWide) {
      membersQuery = membersQuery.in('id', scope.memberIds)
    }

    const { data: members } = await membersQuery

    if (!members || members.length === 0) {
      return NextResponse.json({ teamMemberStats: [], setterStats: [], closerStats: [] })
    }

    const { data: orgForSits } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const contactDispositionIdSet = getContactDispositionIdSet(
      orgForSits?.settings?.canvass_dispositions as any[] | undefined
    )
    const memberIds = members.map((m) => m.id)

    // One read of the reporting views (same rows as the Dashboard page, Sisu and /reports); each member's
    // numbers are then summed from them. Doors/contacts credit whoever actually knocked.
    const periodRows = await fetchPeriodMetricRows(supabase, {
      orgId: profile.org_id,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    })
    const memberIdSet = new Set(memberIds)
    const memberStatsById = new Map(
      members.map((m) => [
        m.id,
        summarizePeriodRows(periodRows, new Set([m.id]), { setterLane: isSetterLikeRole(m.role), contactDispositionIdSet }),
      ])
    )
    const saleOpportunityIds = new Set(
      periodRows.sales
        .filter((sale) => memberIdSet.has(sale.closer_user_id || '') || memberIdSet.has(sale.setter_user_id || ''))
        .map((sale) => sale.opportunity_id)
    )

    const teamMemberStatsAll: TeamStatRow[] = members.map((member) => {
      // Doors/contacts: credited to whoever knocked (reporting views) for every role,
      // so closers / admins who canvass still see knocks; sits/sales stay setter vs owner lane below.
      const { doors: doorsKnocked, contacts, inspectionsSet, inspectionsReceived, sits, sales, calendar: apptsOnCalendar } = memberStatsById.get(member.id)!

      const closeRate = sits > 0 ? (sales / sits) * 100 : null
      const efficiency = apptsOnCalendar > 0 ? (sales / apptsOnCalendar) * 100 : null

      const result: TeamStatRow = {
        id: member.id,
        name: member.full_name || 'Unknown',
        role: member.role,
        doorsKnocked,
        contacts,
        inspectionsSet,
        inspectionsReceived,
        sits,
        sales,
        closeRate: closeRate !== null ? closeRate.toFixed(0) : '—',
        efficiency: efficiency !== null ? efficiency.toFixed(0) : '—',
      }

      if (debug) {
        result._debug = {
          doors_raw: doorsKnocked,
          contacts_raw: contacts,
          inspections_set_raw: inspectionsSet,
          inspections_received_raw: inspectionsReceived,
          sales_raw: sales,
          sits_raw: sits,
        }
      }

      return result
    })

    const teamMemberStats = teamMemberStatsAll.filter((row, idx) => {
      const m = members[idx]!
      return shouldShowUserOnTeamLeaderboard(m, row)
    })

    const setterStats = teamMemberStats
      .filter((m) => isSetterLikeRole(m.role))
      .sort((a, b) => {
        if (b.inspectionsSet !== a.inspectionsSet) return b.inspectionsSet - a.inspectionsSet
        if (b.sits !== a.sits) return b.sits - a.sits
        if (b.sales !== a.sales) return b.sales - a.sales
        return b.doorsKnocked - a.doorsKnocked
      })

    const closerStats = teamMemberStats
      .filter((m) => !isSetterLikeRole(m.role))
      .sort((a, b) => {
        if (b.sales !== a.sales) return b.sales - a.sales
        if (b.sits !== a.sits) return b.sits - a.sits
        const crA = a.closeRate === '—' ? -1 : parseFloat(a.closeRate)
        const crB = b.closeRate === '—' ? -1 : parseFloat(b.closeRate)
        if (crB !== crA) return crB - crA
        const effA = a.efficiency === '—' ? -1 : parseFloat(a.efficiency)
        const effB = b.efficiency === '—' ? -1 : parseFloat(b.efficiency)
        return effB - effA
      })

    const distinctDealCounts = {
      sitOpportunitiesInPeriod: periodRows.sits.length,
      saleOpportunitiesInPeriod: saleOpportunityIds.size,
    }

    const response: any = {
      teamMemberStats,
      setterStats,
      closerStats,
      teamMemberCount: teamMemberStats.length,
      distinctDealCounts,
    }
    
    // Include date range info in debug mode
    if (debug) {
      const debugDateRange = dateRange as any
      response._debug = {
        timeframe,
        timezone: TIMEZONE,
        start_utc: start.toISOString(),
        end_utc: end.toISOString(),
        start_local: debugDateRange.startLocal || start.toISOString(),
        end_local: debugDateRange.endLocal || end.toISOString(),
        aggregates: 'reporting_views',
        distinct_sit_opportunities: distinctDealCounts.sitOpportunitiesInPeriod,
        distinct_sale_opportunities: distinctDealCounts.saleOpportunitiesInPeriod,
        team_member_count: teamMemberStats.length,
        team_member_count_pre_filter: members.length,
        viewer_role: profile.role,
        viewer_team_id: profile.team_id,
        week_starts_on: 'Sunday',
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Team stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch team stats' }, { status: 500 })
  }
}
