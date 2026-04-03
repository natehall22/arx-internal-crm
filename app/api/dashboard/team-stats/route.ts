import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getDateRangeForTimeFrame, getDateRangeWithDebug } from '@/lib/date-ranges'
import {
  getSitOutcomeNormalizedIdSet,
  normalizeInspectionOutcomeId,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'

export const dynamic = 'force-dynamic'

const TIMEZONE = 'America/New_York'

function getSessionFromRequest(req: NextRequest) {
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

function isSetterLikeRole(role?: string | null) {
  return role === 'canvasser' || role === 'setter'
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

    if (!isAdmin && !isRegionalManager && !isSalesManager) {
      return NextResponse.json({ teamMemberStats: [] })
    }

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

    // Get team member IDs based on role
    let teamMemberIds: string[] = []
    
    if (isSalesManager && profile.team_id) {
      const { data: teamMembers } = await supabase
        .from('users')
        .select('id')
        .eq('team_id', profile.team_id)
      teamMemberIds = teamMembers?.map(m => m.id) || []
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
    }

    // Get all active team members
    let membersQuery = supabase
      .from('users')
      .select('id, full_name, role, show_in_reports')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .neq('show_in_reports', false)
    
    if (!isAdmin && teamMemberIds.length > 0) {
      membersQuery = membersQuery.in('id', teamMemberIds)
    }
    
    const { data: members } = await membersQuery

    if (!members || members.length === 0) {
      return NextResponse.json({ teamMemberStats: [] })
    }

    // ============================================
    // SEPARATE QUERIES TO AVOID JOIN MULTIPLICATION
    // ============================================

    // 1) LEADS (raw door knocks from canvassing)
    // owner_user_id = the setter who knocked the door
    let leadsQuery = supabase
      .from('leads')
      .select('id, owner_user_id, canvass_disposition, source, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    if (!isAdmin && teamMemberIds.length > 0) {
      leadsQuery = leadsQuery.in('owner_user_id', teamMemberIds)
    }

    const { data: leads } = await leadsQuery

    // 2) SCHEDULED APPOINTMENTS (inspections set)
    // canvasser_user_id = the setter who scheduled the inspection
    // This is the SOURCE OF TRUTH for "who set the inspection"
    let appointmentsQuery = supabase
      .from('scheduled_appointments')
      .select('id, canvasser_user_id, lead_id, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    if (!isAdmin && teamMemberIds.length > 0) {
      appointmentsQuery = appointmentsQuery.in('canvasser_user_id', teamMemberIds)
    }

    const { data: appointments } = await appointmentsQuery

    // 3) OPPORTUNITIES (for sales - closer gets credit)
    // owner_user_id = the closer who ran the inspection
    const oppsQuery = supabase
      .from('opportunities')
      .select('id, owner_user_id, setter_user_id, inspection_outcome, inspection_outcome_at, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())

    const { data: opportunities } = await oppsQuery

    // Sales are counted by sale event time, not opportunity creation time.
    const salesOppsQuery = supabase
      .from('opportunities')
      .select('id, owner_user_id, setter_user_id, inspection_outcome_at')
      .eq('org_id', profile.org_id)
      .eq('inspection_outcome', 'sale')
      .gte('inspection_outcome_at', start.toISOString())
      .lt('inspection_outcome_at', end.toISOString())

    const { data: salesOpportunities } = await salesOppsQuery

    const { data: orgForSits } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
      orgForSits?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
    )

    let sitOpportunities: {
      id: string
      owner_user_id: string | null
      setter_user_id: string | null
      inspection_outcome: string | null
    }[] = []

    if (sitOutcomeIdSet.size > 0) {
      const { data: sitRows } = await supabase
        .from('opportunities')
        .select('id, owner_user_id, setter_user_id, inspection_outcome, inspection_outcome_at')
        .eq('org_id', profile.org_id)
        .not('inspection_outcome', 'is', null)
        .not('inspection_outcome_at', 'is', null)
        .gte('inspection_outcome_at', start.toISOString())
        .lt('inspection_outcome_at', end.toISOString())

      sitOpportunities =
        (sitRows || []).filter((o) =>
          sitOutcomeIdSet.has(normalizeInspectionOutcomeId(o.inspection_outcome))
        ) || []
    }

    // Contact dispositions - where rep actually talked to someone
    const contactDispositions = ['go_back', 'hot_lead', 'not_interested', 'renter']

    // Build a set of lead_ids that already have appointments
    // to avoid double-counting doors/contacts
    const leadsWithAppointments = new Set(
      (appointments || [])
        .filter(a => a.lead_id)
        .map(a => a.lead_id)
    )

    // Calculate stats for each member
    const teamMemberStats = members.map(member => {
      // ---- DOORS ----
      // Raw: leads owned by this user (door knocks)
      const memberLeads = leads?.filter(l => l.owner_user_id === member.id) || []
      const rawDoors = memberLeads.length

      // Inspections set by this user
      const memberAppointments = appointments?.filter(a => a.canvasser_user_id === member.id) || []
      const inspectionsSet = memberAppointments.length

      // Bonus doors: inspections that were NOT already counted via a lead
      // (i.e., inspection was set without a prior canvass knock on that lead)
      const inspectionBonusDoors = memberAppointments.filter(a => {
        // If appointment has no lead_id, it's a bonus
        if (!a.lead_id) return true
        // If the lead exists but was owned by someone else, this setter gets bonus
        const lead = memberLeads.find(l => l.id === a.lead_id)
        return !lead // No matching lead owned by this user = bonus
      }).length

      const finalDoors = rawDoors + inspectionBonusDoors

      // ---- CONTACTS ----
      // Raw: leads with contact disposition
      const rawContacts = memberLeads.filter(l => 
        contactDispositions.includes(l.canvass_disposition)
      ).length

      // Bonus contacts: inspections that were NOT already counted as contacts
      // An inspection implies contact was made
      const inspectionBonusContacts = memberAppointments.filter(a => {
        if (!a.lead_id) return true
        // Check if this lead was already counted as a contact
        const lead = memberLeads.find(l => l.id === a.lead_id)
        if (!lead) return true // No lead = bonus contact
        // If lead exists but wasn't a contact disposition, bonus
        return !contactDispositions.includes(lead.canvass_disposition)
      }).length

      const finalContacts = rawContacts + inspectionBonusContacts

      // ---- SALES ----
      // Setter/canvasser rows are credited from setter_user_id on sold opportunities.
      // Other roles are credited from owner_user_id (closer).
      const memberOwnedOpps = opportunities?.filter(o => o.owner_user_id === member.id) || []
      const sales = (salesOpportunities || []).filter(o =>
        isSetterLikeRole(member.role) ? o.setter_user_id === member.id : o.owner_user_id === member.id
      ).length

      // Sits: credit setter when known; fall back to owner when setter_user_id is null
      const sits = (sitOpportunities || []).filter((o) =>
        o.setter_user_id === member.id ||
        (!o.setter_user_id && o.owner_user_id === member.id)
      ).length

      // ---- CLOSE RATE ----
      // Based on inspections RUN by this closer (not set)
      const totalInspectionsRun = memberOwnedOpps.filter(o => o.inspection_outcome).length
      const closeRate = totalInspectionsRun > 0 ? (sales / totalInspectionsRun * 100) : 0

      const result: any = {
        id: member.id,
        name: member.full_name || 'Unknown',
        role: member.role,
        doorsKnocked: finalDoors,
        contacts: finalContacts,
        inspectionsSet,
        sits,
        sales,
        closeRate: closeRate.toFixed(0),
      }

      // Include raw breakdown in debug mode
      if (debug) {
        result._debug = {
          doors_raw: rawDoors,
          doors_bonus_from_inspections: inspectionBonusDoors,
          doors_display: finalDoors,
          contacts_raw: rawContacts,
          contacts_bonus_from_inspections: inspectionBonusContacts,
          contacts_display: finalContacts,
          inspections_set_raw: inspectionsSet,
          sales_raw: sales,
          sits_raw: sits,
          inspections_run: totalInspectionsRun,
        }
      }

      return result
    })

    // Sort by sales, then sits, then inspections, then doors
    teamMemberStats.sort((a, b) => {
      if (b.sales !== a.sales) return b.sales - a.sales
      if (b.sits !== a.sits) return b.sits - a.sits
      if (b.inspectionsSet !== a.inspectionsSet) return b.inspectionsSet - a.inspectionsSet
      return b.doorsKnocked - a.doorsKnocked
    })

    const response: any = { teamMemberStats }
    
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
        total_leads_in_range: leads?.length || 0,
        total_appointments_in_range: appointments?.length || 0,
        total_opportunities_in_range: opportunities?.length || 0,
        total_sales_events_in_range: salesOpportunities?.length || 0,
        sit_outcome_ids_configured: sitOutcomeIdSet.size,
        total_sit_events_in_range: sitOpportunities.length,
        team_member_count: members.length,
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
