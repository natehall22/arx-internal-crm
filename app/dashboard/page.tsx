export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import DashboardClient from './DashboardClient'
import OpsDashboard from '@/components/dashboard/OpsDashboard'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import {
  getSitOutcomeNormalizedIdSet,
  type InspectionOutcomeConfigRow,
} from '@/lib/inspection-outcomes'
import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import {
  getAttributedInstallationSales,
  getContactDispositionIdSet,
  isCanvassDoorLead,
  isContactDisposition,
  SALE_AGREEMENT_TYPES,
  type InstallationSaleContractRow,
} from '@/lib/sales-metrics'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'
import { shouldShowUserOnTeamLeaderboard } from '@/lib/dashboard-team-leaderboard'
import { isOrgSuperuserRoleSlug, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'

export default async function DashboardPage() {
  const { authUser, profile } = await requireAuth()
  const supabase = createClient()

  // Check user's dashboard_view preference
  // If set to 'ops', render the Ops Dashboard
  if (profile.dashboard_view === 'ops') {
    const admin = createServiceClient()
    const { canJobBoard } = await resolveOpsAccess(admin, authUser.id, profile)
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Operations Dashboard</h1>
            <p className="text-gray-600 mt-1">Overview of jobs, materials, and work orders</p>
          </div>
          <OpsDashboard profile={profile} canJobBoard={canJobBoard} />
        </div>
      </div>
    )
  }

  // Legacy redirect for operations role (fallback)
  if (profile.role === 'operations') {
    redirect('/ops/dashboard')
  }

  const isAdmin = isOrgSuperuserRoleSlug(profile.role)
  const isRegionalManager = profile.role === 'regional_manager'
  const isSalesManager = profile.role === 'sales_manager'

  let dashboardSettings = null
  
  const { data: userSettings } = await supabase
    .from('dashboard_settings')
    .select('*')
    .eq('org_id', profile.org_id)
    .eq('user_id', profile.id)
    .single()
  
  if (userSettings) {
    dashboardSettings = userSettings.settings
  } else if (profile.team_id) {
    const { data: teamSettings } = await supabase
      .from('dashboard_settings')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('team_id', profile.team_id)
      .is('user_id', null)
      .single()
    
    if (teamSettings) dashboardSettings = teamSettings.settings
  }
  
  if (!dashboardSettings && profile.region_id) {
    const { data: regionSettings } = await supabase
      .from('dashboard_settings')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('region_id', profile.region_id)
      .is('team_id', null)
      .is('user_id', null)
      .single()
    
    if (regionSettings) dashboardSettings = regionSettings.settings
  }

  const settings = dashboardSettings || {
    widgets: ['stats', 'progress', 'appointments', 'activity'],
    goals: { doors_knocked: 100, inspections: 20, sales: 5 },
  }
  let teamMemberIds: string[] = [profile.id]
  if (isSalesManager && profile.team_id) {
    const { data: teamMembers } = await supabase
      .from('users')
      .select('id')
      .eq('team_id', profile.team_id)
    teamMemberIds = teamMembers?.map(m => m.id) || [profile.id]
  } else if (isRegionalManager && profile.region_id) {
    const { data: regionTeams } = await supabase
      .from('teams')
      .select('id')
      .eq('region_id', profile.region_id)
    const teamIds = regionTeams?.map(t => t.id) || []
    const { data: regionMembers } = await supabase
      .from('users')
      .select('id')
      .in('team_id', teamIds)
    teamMemberIds = regionMembers?.map(m => m.id) || [profile.id]
  } else if (isAdmin) {
    teamMemberIds = []
  } else if (!isRegionalManager && !isSalesManager && profile.team_id) {
    // Match team-stats / personal-stats: team members see team rollups (incl. closer-set inspections).
    const { data: teamMembers } = await supabase
      .from('users')
      .select('id')
      .eq('team_id', profile.team_id)
    teamMemberIds = teamMembers?.map(m => m.id) || [profile.id]
  }

  // Calculate week start date using shared utility
  // Uses America/New_York timezone with Sunday as week start
  const { start: weekStart, end: weekEnd } = getDateRangeForTimeFrame('week', 'America/New_York')

  // Fetch leads created this week (filter in query to avoid Supabase row limits)
  let leadsQuery = supabase
    .from('leads')
    .select('id, status, source, canvass_disposition, created_at, owner_user_id, pin_attributed_user_id')
    .eq('org_id', profile.org_id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      const idList = teamMemberIds.join(',')
      leadsQuery = leadsQuery.or(`owner_user_id.in.(${idList}),pin_attributed_user_id.in.(${idList})`)
    } else {
      leadsQuery = leadsQuery.or(
        `owner_user_id.eq.${profile.id},pin_attributed_user_id.eq.${profile.id}`
      )
    }
  }
  const { data: allLeads, error: leadsError } = await leadsQuery

  // Sales are signed Installation or Repair Agreements. Inspection feedback outcomes only drive sits/no-sits.
  const { data: salesContracts } = await supabase
    .from('order_form_contracts')
    .select('id, opportunity_id, customer_signed_at, opportunities(owner_user_id, setter_user_id)')
    .eq('org_id', profile.org_id)
    .in('agreement_type', SALE_AGREEMENT_TYPES)
    .eq('status', 'completed')
    .not('customer_signed_at', 'is', null)
    .gte('customer_signed_at', weekStart.toISOString())
    .lt('customer_signed_at', weekEnd.toISOString())
    .order('customer_signed_at', { ascending: false })
  const salesOpportunities = getAttributedInstallationSales(
    salesContracts as InstallationSaleContractRow[] | null
  )

  const [{ data: orgForSits }, { count: badgeCount }] = await Promise.all([
    supabase
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single(),
    supabase
      .from('user_badges')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id),
  ])

  const sitOutcomeIdSet = getSitOutcomeNormalizedIdSet(
    orgForSits?.settings?.inspection_outcomes as InspectionOutcomeConfigRow[] | undefined
  )
  const contactDispositionIdSet = getContactDispositionIdSet(
    orgForSits?.settings?.canvass_dispositions as any[] | undefined
  )

  const sitOpportunities =
    sitOutcomeIdSet.size === 0
      ? []
      : await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
          orgId: profile.org_id,
          startIso: weekStart.toISOString(),
          endIso: weekEnd.toISOString(),
          sitOutcomeIdSet,
        })

  // Appointments on closer's calendar in this period (by scheduled_for) — efficiency denominator
  const { data: apptsForEfficiency } = await supabase
    .from('scheduled_appointments')
    .select('id, closer_user_id')
    .eq('org_id', profile.org_id)
    .not('closer_user_id', 'is', null)
    .gte('scheduled_for', weekStart.toISOString())
    .lt('scheduled_for', weekEnd.toISOString())

  // Fetch scheduled_appointments created this week for accurate inspection attribution
  // canvasser_user_id = the setter who scheduled the inspection (SOURCE OF TRUTH)
  const { data: allAppointments } = await supabase
    .from('scheduled_appointments')
    .select('id, canvasser_user_id, closer_user_id, lead_id, created_at')
    .eq('org_id', profile.org_id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())

  let projectsQuery = supabase
    .from('projects')
    .select('status, created_at, owner_user_id')
    .eq('org_id', profile.org_id)

  // Closers see their own projects only in Account Overview — not the whole team's project count.
  const projectOwnerScopeIds =
    !isAdmin && isRepLikeCustomerRecordRole(profile.role) ? [profile.id] : teamMemberIds

  if (!isAdmin) {
    if (projectOwnerScopeIds.length > 1) {
      projectsQuery = projectsQuery.in('owner_user_id', projectOwnerScopeIds)
    } else {
      projectsQuery = projectsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { data: projects } = await projectsQuery

  // Fetch all-time counts for Account Overview section
  // These are separate from the weekly stats used for progress tracking
  let allTimeLeadsQuery = supabase
    .from('leads')
    .select('id, status, source', { count: 'exact', head: true })
    .eq('org_id', profile.org_id)
    .neq('source', 'door_to_door') // Exclude raw door knocks from "Total Leads"
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      allTimeLeadsQuery = allTimeLeadsQuery.in('owner_user_id', teamMemberIds)
    } else {
      allTimeLeadsQuery = allTimeLeadsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { count: totalLeadsCount } = await allTimeLeadsQuery

  // Count new leads (status = 'new')
  let newLeadsQuery = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', profile.org_id)
    .eq('status', 'new')
    .neq('source', 'door_to_door')
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      newLeadsQuery = newLeadsQuery.in('owner_user_id', teamMemberIds)
    } else {
      newLeadsQuery = newLeadsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { count: newLeadsCount } = await newLeadsQuery

  // Count all-time opportunities
  let allTimeOppsQuery = supabase
    .from('opportunities')
    .select('id, status', { count: 'exact', head: true })
    .eq('org_id', profile.org_id)
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      allTimeOppsQuery = allTimeOppsQuery.in('owner_user_id', teamMemberIds)
    } else {
      allTimeOppsQuery = allTimeOppsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { count: totalOppsCount } = await allTimeOppsQuery

  // Count open opportunities
  let openOppsQuery = supabase
    .from('opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', profile.org_id)
    .eq('status', 'open')
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      openOppsQuery = openOppsQuery.in('owner_user_id', teamMemberIds)
    } else {
      openOppsQuery = openOppsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { count: openOppsCount } = await openOppsQuery

  const { data: pendingPrompts } = await supabase
    .from('pending_status_prompts')
    .select(`
      *,
      scheduled_appointments(
        *,
        leads(homeowner_name, address_text)
      )
    `)
    .eq('closer_user_id', profile.id)
    .eq('completed', false)
    .eq('dismissed', false)
    .lte('prompt_at', new Date().toISOString())
    .order('prompt_at', { ascending: true })

  const { data: upcomingAppointments } = await supabase
    .from('scheduled_appointments')
    .select(`
      *,
      leads(homeowner_name, address_text)
    `)
    .eq('closer_user_id', profile.id)
    .eq('status', 'scheduled')
    .gte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(5)

  let activityQuery = supabase
    .from('activities')
    .select('*, users(full_name)')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })
    .limit(10)
  
  if (!isAdmin && teamMemberIds.length === 1) {
    activityQuery = activityQuery.eq('user_id', profile.id)
  }
  const { data: recentActivities } = await activityQuery

  // Fetch team member stats for managers/admins and team members
  let teamMemberStats: any[] = []
  let setterTeamStats: any[] = []
  let closerTeamStats: any[] = []
  const canViewTeamLeaderboard =
    isAdmin || isSalesManager || isRegionalManager || !!profile.team_id

  if (canViewTeamLeaderboard) {
    let membersQuery = supabase
      .from('users')
      .select('id, full_name, role, show_in_reports, active')
      .eq('org_id', profile.org_id)

    if (isSalesManager && profile.team_id) {
      membersQuery = membersQuery.eq('team_id', profile.team_id)
    } else if (isRegionalManager && profile.region_id) {
      const { data: regionTeams } = await supabase
        .from('teams')
        .select('id')
        .eq('region_id', profile.region_id)
      const teamIds = regionTeams?.map(t => t.id) || []
      if (teamIds.length > 0) {
        membersQuery = membersQuery.in('team_id', teamIds)
      }
    } else if (!isAdmin && !isSalesManager && !isRegionalManager && profile.team_id) {
      membersQuery = membersQuery.eq('team_id', profile.team_id)
    }

    const { data: members } = await membersQuery
    
    if (members && members.length > 0) {
      const built: any[] = []
      for (const member of members) {
        // Leads attributed to this member (owner or frozen pin id if user was deleted)
        const memberLeads = (allLeads || []).filter(
          l => getAttributedCanvassLeadUserId(l) === member.id && isCanvassDoorLead(l)
        )
        const rawDoors = memberLeads.length

        // Count contacts - only dispositions where they talked to someone
        const rawContacts = memberLeads.filter(l => isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length

        // Inspections set this week - from scheduled_appointments.canvasser_user_id (SOURCE OF TRUTH)
        const memberAppointments = (allAppointments || []).filter(a =>
          a.canvasser_user_id === member.id
        )
        const inspectionsSet = memberAppointments.length
        const inspectionsReceived = (allAppointments || []).filter(
          (a) => a.closer_user_id === member.id
        ).length

        const finalDoors = rawDoors
        const finalContacts = rawContacts

        const memberSalesCount = new Set(
          (salesOpportunities || [])
            .filter((o) => o.setter_user_id === member.id || o.owner_user_id === member.id)
            .map((o) => o.opportunity_id || o.id)
        ).size

        const sits = (sitOpportunities || []).filter((o) =>
          isSetterLikeRole(member.role)
            ? o.setter_user_id === member.id
            : o.owner_user_id === member.id
        ).length

        const memberCloseRate = sits > 0 ? (memberSalesCount / sits * 100) : null
        const memberApptsOnCalendar = (apptsForEfficiency || []).filter(
          (a) => a.closer_user_id === member.id
        ).length
        const memberEfficiency =
          memberApptsOnCalendar > 0 ? (memberSalesCount / memberApptsOnCalendar * 100) : null

        const statsRow = {
          id: member.id,
          name: member.full_name || 'Unknown',
          role: member.role,
          doorsKnocked: finalDoors,
          contacts: finalContacts,
          inspectionsSet,
          inspectionsReceived,
          sits,
          sales: memberSalesCount,
          closeRate: memberCloseRate !== null ? memberCloseRate.toFixed(0) : '—',
          efficiency: memberEfficiency !== null ? memberEfficiency.toFixed(0) : '—',
        }

        if (
          shouldShowUserOnTeamLeaderboard(
            { show_in_reports: member.show_in_reports, active: (member as { active?: boolean }).active },
            statsRow
          )
        ) {
          built.push(statsRow)
        }
      }

      teamMemberStats = built

      setterTeamStats = teamMemberStats
        .filter((m) => isSetterLikeRole(m.role))
        .sort((a, b) => {
          if (b.inspectionsSet !== a.inspectionsSet) return b.inspectionsSet - a.inspectionsSet
          if (b.sits !== a.sits) return b.sits - a.sits
          if (b.sales !== a.sales) return b.sales - a.sales
          return b.doorsKnocked - a.doorsKnocked
        })

      closerTeamStats = teamMemberStats
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
    }
  }

  // Data is already filtered by date in queries, so use directly
  const thisWeekLeads = (allLeads || []).filter(isCanvassDoorLead)
  const rawDoorsKnocked = thisWeekLeads.length
  const rawContacts = thisWeekLeads.filter(l => isContactDisposition(l.canvass_disposition, contactDispositionIdSet)).length
  
  // Inspections set - from scheduled_appointments.canvasser_user_id (SOURCE OF TRUTH)
  // Filter by user role for non-admins
  const thisWeekAppointments = (allAppointments || []).filter(a => 
    isAdmin || a.canvasser_user_id === profile.id || teamMemberIds.includes(a.canvasser_user_id || '')
  )
  const inspectionsSet = thisWeekAppointments.length
  
  const doorsKnocked = rawDoorsKnocked
  const contacts = rawContacts
  
  // Sales attribution: each signed sale credits both the closer/owner and the setter.
  const salesThisWeek = new Set(
    (salesOpportunities || [])
      .filter((o) => {
        if (isAdmin) return true
        return (
          o.setter_user_id === profile.id ||
          o.owner_user_id === profile.id ||
          teamMemberIds.includes(o.setter_user_id || '') ||
          teamMemberIds.includes(o.owner_user_id || '')
        )
      })
      .map((o) => o.opportunity_id || o.id)
  ).size

  const sitsThisWeek = (sitOpportunities || []).filter((o) => {
    if (isAdmin) return true
    if (isSetterLikeRole(profile.role)) {
      return (
        o.setter_user_id === profile.id || teamMemberIds.includes(o.setter_user_id || '')
      )
    }
    return o.owner_user_id === profile.id || teamMemberIds.includes(o.owner_user_id || '')
  }).length

  // Close rate = sales / sits for the selected period
  const closeRate = sitsThisWeek > 0
    ? parseFloat((salesThisWeek / sitsThisWeek * 100).toFixed(1))
    : null

  // Efficiency = sales / appointments on closer's calendar in the selected period
  const appointmentsOnCalendar = (apptsForEfficiency || []).filter((a) =>
    isAdmin || a.closer_user_id === profile.id || teamMemberIds.includes(a.closer_user_id || '')
  ).length
  const efficiency = appointmentsOnCalendar > 0
    ? parseFloat((salesThisWeek / appointmentsOnCalendar * 100).toFixed(1))
    : null

  const goals = settings.goals || { doors_knocked: 100, inspections: 20, sales: 5 }
  const progress = {
    doors_knocked: { current: doorsKnocked, goal: goals.doors_knocked },
    contacts: { current: contacts, goal: Math.round(goals.doors_knocked * 0.3) },
    inspections: { current: inspectionsSet, goal: goals.inspections },
    sales: { current: salesThisWeek, goal: goals.sales },
  }

  const stats = {
    // All-time counts for Account Overview
    totalLeads: totalLeadsCount || 0,
    newLeads: newLeadsCount || 0,
    totalOpportunities: totalOppsCount || 0,
    openOpportunities: openOppsCount || 0,
    totalProjects: projects?.length || 0,
    activeProjects: projects?.filter(p => ['open', 'in_progress'].includes(p.status)).length || 0,
    // Weekly stats
    closeRate,
    efficiency,
    doorsKnockedThisWeek: doorsKnocked,
    contactsThisWeek: contacts,
    inspectionsSetThisWeek: inspectionsSet,
    sitsThisWeek,
    salesThisWeek,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <DashboardClient
        profile={profile}
        stats={stats}
        progress={progress}
        pendingPrompts={pendingPrompts || []}
        upcomingAppointments={upcomingAppointments || []}
        recentActivities={recentActivities || []}
        settings={settings}
        teamMemberStats={teamMemberStats}
        setterTeamStats={setterTeamStats}
        closerTeamStats={closerTeamStats}
        canViewTeamLeaderboard={canViewTeamLeaderboard}
        badgeCount={badgeCount ?? 0}
      />
    </div>
  )
}
