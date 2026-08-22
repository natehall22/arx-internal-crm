import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getDateRangeWithDebug } from '@/lib/date-ranges'
import {
  getAttributedInstallationSales,
  getContactDispositionIdSet,
  isCanvassDoorLead,
  isContactDisposition,
  SALE_AGREEMENT_TYPES,
  type InstallationSaleContractRow,
} from '@/lib/sales-metrics'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import { countsAsInspectionSet } from '@/lib/inspection-set-metrics'
import { isOrgSuperuserRoleSlug } from '@/lib/permissions'
import { createServiceClient } from '@/lib/supabase/service'

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
      .select('org_id, role, team_id, region_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Diagnostics: org superusers only (admin / legacy owner).
    if (!isOrgSuperuserRoleSlug(profile.role)) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const timeframe = searchParams.get('range') || searchParams.get('timeframe') || 'quarter'
    const showAllOrg = searchParams.get('all') === 'true' // Admin can optionally see all
    const dateRange = getDateRangeWithDebug(timeframe, TIMEZONE)
    const { start, end } = dateRange
    
    // Debug logging
    console.log('[debug/team-stats] Date range:', {
      timeframe,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      startLocal: dateRange.startLocal,
      endLocal: dateRange.endLocal,
    })

    // Get viewer's team info
    let viewerTeamName = null
    if (profile.team_id) {
      const { data: team } = await supabase
        .from('teams')
        .select('name')
        .eq('id', profile.team_id)
        .single()
      viewerTeamName = team?.name
    }

    // Determine team member IDs based on viewer's role and team
    let teamMemberIds: string[] = []
    let scopeDescription = ''
    
    if (showAllOrg) {
      scopeDescription = 'All org users (admin override)'
    } else if (profile.team_id) {
      const { data: teamMembers } = await supabase
        .from('users')
        .select('id')
        .eq('team_id', profile.team_id)
        .eq('active', true)
      teamMemberIds = teamMembers?.map(m => m.id) || []
      scopeDescription = `Team: ${viewerTeamName || profile.team_id}`
    } else if (profile.region_id) {
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
          .eq('active', true)
        teamMemberIds = regionMembers?.map(m => m.id) || []
      }
      scopeDescription = `Region: ${profile.region_id}`
    } else {
      scopeDescription = 'All org users (no team assigned)'
    }

    // Get active team members
    let membersQuery = supabase
      .from('users')
      .select('id, full_name, role, email')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .neq('show_in_reports', false)
    
    if (teamMemberIds.length > 0) {
      membersQuery = membersQuery.in('id', teamMemberIds)
    }
    
    const { data: members } = await membersQuery

    if (!members || members.length === 0) {
      return NextResponse.json({ 
        error: 'No members found',
        viewer: { user_id: user.id, team_id: profile.team_id },
        scope: scopeDescription,
      }, { status: 404 })
    }

    // Get member IDs for scoped queries
    const memberIds = members.map(m => m.id)

    // Fetch data SCOPED to team members only (for scalability)
    let leadsQuery = supabase
      .from('leads')
      .select('id, owner_user_id, pin_attributed_user_id, canvass_disposition, source, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
    
    if (memberIds.length > 0 && memberIds.length < 100) {
      leadsQuery = leadsQuery.in('owner_user_id', memberIds)
    }
    
    const { data: leads } = await leadsQuery

    let appointmentsQuery = supabase
      .from('scheduled_appointments')
      .select('id, canvasser_user_id, closer_user_id, lead_id, created_at, status, appointment_type')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
    
    if (memberIds.length > 0 && memberIds.length < 100) {
      appointmentsQuery = appointmentsQuery.in('canvasser_user_id', memberIds)
    }
    
    const { data: appointments } = await appointmentsQuery

    let opportunitiesQuery = supabase
      .from('opportunities')
      .select('id, owner_user_id, setter_user_id, inspection_outcome, created_at')
      .eq('org_id', profile.org_id)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
    
    if (memberIds.length > 0 && memberIds.length < 100) {
      opportunitiesQuery = opportunitiesQuery.in('owner_user_id', memberIds)
    }
    
    const { data: opportunities } = await opportunitiesQuery

    const { data: signedContracts } = await supabase
      .from('order_form_contracts')
      .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
      .eq('org_id', profile.org_id)
      .in('agreement_type', SALE_AGREEMENT_TYPES)
      .eq('status', 'completed')
      .not('customer_signed_at', 'is', null)
      .gte('customer_signed_at', start.toISOString())
      .lt('customer_signed_at', end.toISOString())
      .order('customer_signed_at', { ascending: false })

    const signedSales = getAttributedInstallationSales(
      signedContracts as InstallationSaleContractRow[] | null
    )

    const { data: orgRow } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const contactDispositionIdSet = getContactDispositionIdSet(
      orgRow?.settings?.canvass_dispositions as any[] | undefined
    )

    const reps = members.map(member => {
      // LEADS (raw door knocks)
      const memberLeads = leads?.filter(l => getAttributedCanvassLeadUserId(l) === member.id && isCanvassDoorLead(l)) || []
      const rawDoors = memberLeads.length
      const rawContacts = memberLeads.filter(l =>
        isContactDisposition(l.canvass_disposition, contactDispositionIdSet)
      ).length

      // APPOINTMENTS (inspections set by this user)
      const memberAppointments =
        appointments?.filter(
          (a) => a.canvasser_user_id === member.id && countsAsInspectionSet(a)
        ) || []
      const inspectionsSet = memberAppointments.length

      // Calculate bonus doors/contacts
      const inspectionBonusDoors = memberAppointments.filter(a => {
        if (!a.lead_id) return true
        const lead = memberLeads.find(l => l.id === a.lead_id)
        return !lead
      }).length

      const inspectionBonusContacts = memberAppointments.filter(a => {
        if (!a.lead_id) return true
        const lead = memberLeads.find(l => l.id === a.lead_id)
        if (!lead) return true
        return !isContactDisposition(lead.canvass_disposition, contactDispositionIdSet)
      }).length

      // SALES (completed Installation or Repair Agreement)
      const memberOwnedOpps = opportunities?.filter(o => o.owner_user_id === member.id) || []
      const sales = signedSales.filter(o => o.owner_user_id === member.id).length
      const totalInspectionsRun = memberOwnedOpps.filter(o => o.inspection_outcome).length
      const closeRate = totalInspectionsRun > 0 ? (sales / totalInspectionsRun * 100) : 0

      return {
        user_id: member.id,
        name: member.full_name || 'Unknown',
        email: member.email,
        role: member.role,
        doors: {
          raw: rawDoors,
          bonus_from_inspections: inspectionBonusDoors,
          final: rawDoors + inspectionBonusDoors,
        },
        contacts: {
          raw: rawContacts,
          bonus_from_inspections: inspectionBonusContacts,
          final: rawContacts + inspectionBonusContacts,
        },
        inspections: {
          count: inspectionsSet,
          sample_ids: memberAppointments.slice(0, 5).map(a => a.id),
        },
        sales: {
          count: sales,
        },
        close_rate: closeRate.toFixed(1) + '%',
        _debug: {
          leads_owned: memberLeads.slice(0, 3).map(l => ({
            id: l.id,
            disposition: l.canvass_disposition,
            created: l.created_at,
          })),
          appointments_set: memberAppointments.slice(0, 3).map(a => ({
            id: a.id,
            lead_id: a.lead_id,
            closer_id: a.closer_user_id,
            created: a.created_at,
          })),
        },
      }
    })

    // Sort by inspections set (setter performance view)
    reps.sort((a, b) => {
      if (b.inspections.count !== a.inspections.count) return b.inspections.count - a.inspections.count
      return b.doors.final - a.doors.final
    })

    return NextResponse.json({
      viewer: {
        user_id: user.id,
        name: profile.full_name,
        team_id: profile.team_id,
        team_name: viewerTeamName,
        role: profile.role,
      },
      scope: scopeDescription,
      range: {
        timeframe,
        timezone: TIMEZONE,
        week_starts_on: 'Sunday',
        start_utc: start.toISOString(),
        end_utc: end.toISOString(),
        start_local: dateRange.startLocal,
        end_local: dateRange.endLocal,
      },
      team_member_ids: teamMemberIds.length > 0 ? teamMemberIds : 'all_org',
      totals: {
        leads: leads?.length || 0,
        appointments: appointments?.length || 0,
        opportunities: opportunities?.length || 0,
        members: members?.length || 0,
      },
      reps,
      query_info: {
        leads_table: 'owner_user_id = setter who knocked',
        appointments_table: 'canvasser_user_id = setter who scheduled inspection',
        opportunities_table: 'owner_user_id = closer, setter_user_id = setter',
        logic: 'Inspections counted from scheduled_appointments.canvasser_user_id',
        indexes: [
          'idx_scheduled_appointments_canvasser_created',
          'idx_leads_owner_created',
          'idx_opportunities_owner_created',
          'idx_users_team_active',
        ],
      },
    })
  } catch (error) {
    console.error('Debug team stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch debug stats' }, { status: 500 })
  }
}
