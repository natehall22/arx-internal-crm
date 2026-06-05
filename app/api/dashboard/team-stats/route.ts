import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getDateRangeForTimeFrame, getDateRangeWithDebug } from '@/lib/date-ranges'
import {
  getSitOutcomeNormalizedIdSet,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import {
  countSitsByOwner,
  countSitsBySetter,
  fetchEffectiveSitOpportunitiesInPeriod,
} from '@/lib/dashboard-sit-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { shouldShowUserOnTeamLeaderboard } from '@/lib/dashboard-team-leaderboard'
import {
  getAttributedSaleAgreements,
  getContactDispositionIdSet,
  SALE_AGREEMENT_TYPES,
  type SaleAgreementContractRow,
} from '@/lib/sales-metrics'

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

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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

    const supabase = getAdminClient()

    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role, team_id, region_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const isAdmin = profile.role === 'admin'
    const isRegionalManager = profile.role === 'regional_manager'
    const isSalesManager = profile.role === 'sales_manager'

    const searchParams = request.nextUrl.searchParams
    const timeframe = searchParams.get('timeframe') || 'week'
    const debug = searchParams.get('debug') === '1'
    const dateRange = debug 
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

    // Get team member IDs based on role (scope for non-admin data)
    let teamMemberIds: string[] = []

    if (isSalesManager && profile.team_id) {
      const { data: teamMembers } = await supabase
        .from('users')
        .select('id')
        .eq('team_id', profile.team_id)
      teamMemberIds = teamMembers?.map(m => m.id) || []
    } else if (isSalesManager && !profile.team_id) {
      teamMemberIds = [user.id]
    } else if (isRegionalManager && profile.region_id) {
      const { data: regionTeams } = await supabase
        .from('teams')
        .select('id')
        .eq('region_id', profile.region_id)
      const teamIds = regionTeams?.map(t => t.id) || []
      if (teamIds.length > 0) {
        const { data: regionMembers } = await supabase
          .from('users')
          .select('id')
          .in('team_id', teamIds)
        teamMemberIds = regionMembers?.map(m => m.id) || []
      }
    } else if (!isAdmin && !isRegionalManager && !isSalesManager && profile.team_id) {
      const { data: teamMembers } = await supabase
        .from('users')
        .select('id')
        .eq('team_id', profile.team_id)
      teamMemberIds = teamMembers?.map(m => m.id) || []
    } else if (!isAdmin && !isRegionalManager && !isSalesManager) {
      teamMemberIds = [user.id]
    }

    if (!isAdmin && teamMemberIds.length === 0 && !profile.team_id) {
      return NextResponse.json({
        teamMemberStats: [],
        setterStats: [],
        closerStats: [],
        teamMemberCount: 0,
        distinctDealCounts: { sitOpportunitiesInPeriod: 0, saleOpportunitiesInPeriod: 0 },
      })
    }

    // Roster for RPC scope: everyone in org/team (including inactive and show_in_reports = false)
    // so pin-attributed doors/sits still roll up. We filter who appears in the UI after computing stats.
    let membersQuery = supabase
      .from('users')
      .select('id, full_name, role, show_in_reports, active')
      .eq('org_id', profile.org_id)

    if (!isAdmin && teamMemberIds.length > 0) {
      membersQuery = membersQuery.in('id', teamMemberIds)
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

    const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
      orgForSits?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
    )
    const contactDispositionIdSet = getContactDispositionIdSet(
      orgForSits?.settings?.canvass_dispositions as any[] | undefined
    )

    const dispositionIds = Array.from(contactDispositionIdSet)
    const memberIds = members.map((m) => m.id)
    const pOrg = profile.org_id
    const pStart = start.toISOString()
    const pEnd = end.toISOString()

    let dashboardDoorAttributionPinFirst: boolean | null = null
    if (isAdmin) {
      const { data: attrData, error: attrErr } = await supabase.rpc(
        'dashboard_door_rpc_attribution_is_pin_first'
      )
      const attrErrMessage = String(attrErr?.message || '')
      const missingAttributionHelper =
        attrErrMessage.includes('dashboard_door_rpc_attribution_is_pin_first') &&
        (attrErrMessage.toLowerCase().includes('could not find the function') ||
          attrErrMessage.toLowerCase().includes('function') ||
          attrErrMessage.toLowerCase().includes('schema cache'))

      if (!attrErr && typeof attrData === 'boolean') {
        dashboardDoorAttributionPinFirst = attrData
      } else if (missingAttributionHelper) {
        dashboardDoorAttributionPinFirst = false
        console.warn(
          '[team-stats] Attribution helper RPC is missing. Treating dashboard door/contact attribution as unsafe until migration 130 (or 129 + 130) is applied.'
        )
      }
      if (dashboardDoorAttributionPinFirst === false) {
        console.warn(
          '[team-stats] Door/contact SQL may still use owner-first attribution. Apply supabase migration 130 (or 129 + 130) so stats credit pin_attributed_user_id first and exclude inbound disposition-only leads.'
        )
      }
    }

    const [
      doorRows,
      contactRows,
      inspRows,
      inspRecvRows,
      effRows,
      effectiveSitOpportunities,
      saleContractsRes,
    ] = await Promise.all([
      supabase.rpc('dashboard_door_leads_by_owner', {
        p_org_id: pOrg,
        p_start: pStart,
        p_end: pEnd,
        p_member_ids: memberIds,
      }),
      dispositionIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase.rpc('dashboard_contact_leads_by_owner', {
            p_org_id: pOrg,
            p_start: pStart,
            p_end: pEnd,
            p_member_ids: memberIds,
            p_disposition_ids: dispositionIds,
          }),
      supabase.rpc('dashboard_inspections_set_by_canvasser', {
        p_org_id: pOrg,
        p_start: pStart,
        p_end: pEnd,
        p_member_ids: memberIds,
      }),
      supabase.rpc('dashboard_inspections_received_by_closer', {
        p_org_id: pOrg,
        p_start: pStart,
        p_end: pEnd,
        p_member_ids: memberIds,
      }),
      supabase.rpc('dashboard_closer_calendar_appts_by_closer', {
        p_org_id: pOrg,
        p_start: pStart,
        p_end: pEnd,
        p_member_ids: memberIds,
      }),
      sitOutcomeIdSet.size === 0
        ? Promise.resolve([])
        : fetchEffectiveSitOpportunitiesInPeriod(supabase, {
            orgId: pOrg,
            startIso: pStart,
            endIso: pEnd,
            sitOutcomeIdSet,
          }),
      supabase
        .from('order_form_contracts')
        .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
        .eq('org_id', pOrg)
        .in('agreement_type', SALE_AGREEMENT_TYPES)
        .eq('status', 'completed')
        .not('customer_signed_at', 'is', null)
        .gte('customer_signed_at', pStart)
        .lt('customer_signed_at', pEnd),
    ])

    const rpcErr =
      doorRows.error ||
      contactRows.error ||
      inspRows.error ||
      inspRecvRows.error ||
      effRows.error ||
      saleContractsRes.error
    if (rpcErr) throw rpcErr

    type RpcRow = { owner_id?: string; setter_id?: string; canvasser_id?: string; closer_id?: string; cnt: number | string }
    const num = (v: unknown) => Number(v ?? 0)

    const doorByOwner = new Map<string, number>()
    for (const r of (doorRows.data || []) as RpcRow[]) {
      if (r.owner_id) doorByOwner.set(r.owner_id, num(r.cnt))
    }
    const contactByOwner = new Map<string, number>()
    for (const r of (contactRows.data || []) as RpcRow[]) {
      if (r.owner_id) contactByOwner.set(r.owner_id, num(r.cnt))
    }
    const inspByCanvasser = new Map<string, number>()
    for (const r of (inspRows.data || []) as RpcRow[]) {
      if (r.canvasser_id) inspByCanvasser.set(r.canvasser_id, num(r.cnt))
    }
    const inspReceivedByCloser = new Map<string, number>()
    for (const r of (inspRecvRows.data || []) as RpcRow[]) {
      if (r.closer_id) inspReceivedByCloser.set(r.closer_id, num(r.cnt))
    }
    const effByCloser = new Map<string, number>()
    for (const r of (effRows.data || []) as RpcRow[]) {
      if (r.closer_id) effByCloser.set(r.closer_id, num(r.cnt))
    }
    const sitBySetter = countSitsBySetter(effectiveSitOpportunities, memberIds)
    const sitByOwner = countSitsByOwner(effectiveSitOpportunities, memberIds)
    const memberIdSet = new Set(memberIds)
    const saleAgreements = getAttributedSaleAgreements(
      saleContractsRes.data as SaleAgreementContractRow[] | null
    ).filter((sale) => {
      return memberIdSet.has(sale.owner_user_id || '') || memberIdSet.has(sale.setter_user_id || '')
    })
    const salesByMember = new Map<string, Set<string>>()
    const creditSaleToMember = (memberId: string | null, saleKey: string) => {
      if (!memberId || !memberIdSet.has(memberId)) return
      const existing = salesByMember.get(memberId) ?? new Set<string>()
      existing.add(saleKey)
      salesByMember.set(memberId, existing)
    }
    for (const sale of saleAgreements) {
      const saleKey = sale.opportunity_id || sale.id
      creditSaleToMember(sale.setter_user_id, saleKey)
      creditSaleToMember(sale.owner_user_id, saleKey)
    }

    const teamMemberStatsAll: TeamStatRow[] = members.map((member) => {
      // Doors/contacts: pin-first credit from dashboard_* RPCs (see migration 127/128) for every role,
      // so closers / admins who canvass still see knocks; sits/sales stay setter vs owner lane below.
      const doorsKnocked = doorByOwner.get(member.id) ?? 0
      const contacts = contactByOwner.get(member.id) ?? 0
      const inspectionsSet = inspByCanvasser.get(member.id) ?? 0
      const inspectionsReceived = inspReceivedByCloser.get(member.id) ?? 0
      const sits = isSetterLikeRole(member.role)
        ? (sitBySetter.get(member.id) ?? 0)
        : (sitByOwner.get(member.id) ?? 0)
      const sales = salesByMember.get(member.id)?.size ?? 0
      const apptsOnCalendar = effByCloser.get(member.id) ?? 0

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
      sitOpportunitiesInPeriod: effectiveSitOpportunities.length,
      saleOpportunitiesInPeriod: new Set(saleAgreements.map((sale) => sale.opportunity_id || sale.id)).size,
    }

    const response: any = {
      teamMemberStats,
      setterStats,
      closerStats,
      teamMemberCount: teamMemberStats.length,
      distinctDealCounts,
      ...(isAdmin ? { dashboardDoorAttributionPinFirst } : {}),
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
        aggregates: 'postgres_rpc',
        sit_outcome_ids_configured: sitOutcomeIdSet.size,
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
