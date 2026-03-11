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

export default async function DashboardPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  // Check user's dashboard_view preference
  // If set to 'ops', render the Ops Dashboard
  if (profile.dashboard_view === 'ops') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Operations Dashboard</h1>
            <p className="text-gray-600 mt-1">Overview of jobs, materials, and work orders</p>
          </div>
          <OpsDashboard profile={profile} />
        </div>
      </div>
    )
  }

  // Legacy redirect for operations role (fallback)
  if (profile.role === 'operations') {
    redirect('/ops/dashboard')
  }

  const isAdmin = profile.role === 'admin'
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
  const isSetterLikeRole = (role?: string | null) => role === 'canvasser' || role === 'setter'

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
  }

  // Calculate week start date using shared utility
  // Uses America/New_York timezone with Sunday as week start
  const { start: weekStart, end: weekEnd } = getDateRangeForTimeFrame('week', 'America/New_York')

  // Fetch leads created this week (filter in query to avoid Supabase row limits)
  let leadsQuery = supabase
    .from('leads')
    .select('id, status, source, canvass_disposition, created_at, owner_user_id')
    .eq('org_id', profile.org_id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      leadsQuery = leadsQuery.in('owner_user_id', teamMemberIds)
    } else {
      leadsQuery = leadsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { data: allLeads, error: leadsError } = await leadsQuery

  // Fetch opportunities created this week for accurate attribution
  let oppsQuery = supabase
    .from('opportunities')
    .select('lead_id, status, inspection_outcome, inspection_outcome_at, created_at, owner_user_id, setter_user_id')
    .eq('org_id', profile.org_id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())
  
  // For opportunities, we need all org opportunities to properly attribute:
  // - inspections_set to setter_user_id
  // - sales/close_rate to owner_user_id (closer)
  // So we don't filter by owner_user_id here for non-admins
  const { data: opportunities } = await oppsQuery

  // Sales events should be driven by when the deal is actually marked sold.
  // Proposal approval sets inspection_outcome='sale' and inspection_outcome_at.
  const { data: salesOpportunities } = await supabase
    .from('opportunities')
    .select('id, owner_user_id, setter_user_id, inspection_outcome_at')
    .eq('org_id', profile.org_id)
    .eq('inspection_outcome', 'sale')
    .gte('inspection_outcome_at', weekStart.toISOString())
    .lt('inspection_outcome_at', weekEnd.toISOString())

  // Fetch scheduled_appointments created this week for accurate inspection attribution
  // canvasser_user_id = the setter who scheduled the inspection (SOURCE OF TRUTH)
  const { data: allAppointments } = await supabase
    .from('scheduled_appointments')
    .select('id, canvasser_user_id, lead_id, created_at')
    .eq('org_id', profile.org_id)
    .gte('created_at', weekStart.toISOString())
    .lt('created_at', weekEnd.toISOString())

  let projectsQuery = supabase
    .from('projects')
    .select('status, created_at, owner_user_id')
    .eq('org_id', profile.org_id)
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      projectsQuery = projectsQuery.in('owner_user_id', teamMemberIds)
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

  // Fetch team member stats for managers/admins
  let teamMemberStats: any[] = []
  if (isAdmin || isSalesManager || isRegionalManager) {
    // Get all active team members with their info
    // Filter out users who have show_in_reports set to false
    let membersQuery = supabase
      .from('users')
      .select('id, full_name, role, show_in_reports')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .neq('show_in_reports', false) // Exclude users who opted out of leaderboards
    
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
    }
    
    const { data: members } = await membersQuery
    
    // Contact dispositions - where rep actually talked to someone
    const contactDispositions = ['go_back', 'hot_lead', 'not_interested', 'renter']

    if (members && members.length > 0) {
      // Calculate stats for each member
      // Data is already filtered by date in queries
      for (const member of members) {
        // Leads owned by this member (already filtered to this week)
        const memberLeads = (allLeads || []).filter(l => l.owner_user_id === member.id)
        const rawDoors = memberLeads.length
        
        // Count contacts - only dispositions where they talked to someone
        const rawContacts = memberLeads.filter(l => 
          l.canvass_disposition && contactDispositions.includes(l.canvass_disposition)
        ).length
        
        // Inspections set this week - from scheduled_appointments.canvasser_user_id (SOURCE OF TRUTH)
        const memberAppointments = (allAppointments || []).filter(a => 
          a.canvasser_user_id === member.id
        )
        const inspectionsSet = memberAppointments.length
        
        // Calculate bonus doors/contacts from inspections
        // Bonus = inspections that weren't already counted via a lead owned by this user
        const inspectionBonusDoors = memberAppointments.filter(a => {
          if (!a.lead_id) return true
          const lead = memberLeads.find(l => l.id === a.lead_id)
          return !lead
        }).length
        
        const inspectionBonusContacts = memberAppointments.filter(a => {
          if (!a.lead_id) return true
          const lead = memberLeads.find(l => l.id === a.lead_id)
          if (!lead) return true
          return !contactDispositions.includes(lead.canvass_disposition || '')
        }).length
        
        const finalDoors = rawDoors + inspectionBonusDoors
        const finalContacts = rawContacts + inspectionBonusContacts
        
        const memberOwnedOpps = (opportunities || []).filter(o => o.owner_user_id === member.id)
        
        // Sales attribution:
        // - setter/canvasser rows get credit for opportunities where they were setter_user_id
        // - all other roles get closer credit via owner_user_id
        const memberSales = (salesOpportunities || []).filter(o =>
          isSetterLikeRole(member.role) ? o.setter_user_id === member.id : o.owner_user_id === member.id
        )
        
        // Close rate based on inspections run this week by this closer
        const inspectionsRun = memberOwnedOpps.filter(o => o.inspection_outcome).length
        const closeRate = inspectionsRun > 0 ? (memberSales.length / inspectionsRun * 100) : 0
        
        teamMemberStats.push({
          id: member.id,
          name: member.full_name || 'Unknown',
          role: member.role,
          doorsKnocked: finalDoors,
          contacts: finalContacts,
          inspectionsSet, // Credit to setter via scheduled_appointments.canvasser_user_id
          sales: memberSales.length, // Credit to closer
          closeRate: closeRate.toFixed(0),
        })
      }
      
      // Sort by sales, then inspections, then doors
      teamMemberStats.sort((a, b) => {
        if (b.sales !== a.sales) return b.sales - a.sales
        if (b.inspectionsSet !== a.inspectionsSet) return b.inspectionsSet - a.inspectionsSet
        return b.doorsKnocked - a.doorsKnocked
      })
    }
  }

  // Data is already filtered by date in queries, so use directly
  const thisWeekLeads = allLeads || []
  const rawDoorsKnocked = thisWeekLeads.length
  const contactDisps = ['go_back', 'hot_lead', 'not_interested', 'renter']
  const rawContacts = thisWeekLeads.filter(l => 
    contactDisps.includes(l.canvass_disposition || '')
  ).length
  
  // Inspections set - from scheduled_appointments.canvasser_user_id (SOURCE OF TRUTH)
  // Filter by user role for non-admins
  const thisWeekAppointments = (allAppointments || []).filter(a => 
    isAdmin || a.canvasser_user_id === profile.id || teamMemberIds.includes(a.canvasser_user_id || '')
  )
  const inspectionsSet = thisWeekAppointments.length
  
  // Calculate bonus doors/contacts from inspections
  // Bonus = inspections that weren't already counted via a lead
  const inspectionBonusDoors = thisWeekAppointments.filter(a => {
    if (!a.lead_id) return true
    const lead = thisWeekLeads.find(l => l.id === a.lead_id)
    return !lead
  }).length
  const inspectionBonusContacts = thisWeekAppointments.filter(a => {
    if (!a.lead_id) return true
    const lead = thisWeekLeads.find(l => l.id === a.lead_id)
    if (!lead) return true
    return !contactDisps.includes(lead.canvass_disposition || '')
  }).length
  
  const doorsKnocked = rawDoorsKnocked + inspectionBonusDoors
  const contacts = rawContacts + inspectionBonusContacts
  
  // Sales attribution:
  // - setter/canvasser users get credit for sales from their sets
  // - other roles keep closer credit
  const salesThisWeek = (salesOpportunities || []).filter(o =>
    isSetterLikeRole(profile.role)
      ? (isAdmin || o.setter_user_id === profile.id || teamMemberIds.includes(o.setter_user_id || ''))
      : (isAdmin || o.owner_user_id === profile.id || teamMemberIds.includes(o.owner_user_id || ''))
  ).length

  // Close rate based on inspections run by closer (owner)
  const userOwnedOpps = (opportunities || []).filter(o => 
    isAdmin || o.owner_user_id === profile.id || teamMemberIds.includes(o.owner_user_id || '')
  )
  const totalInspectionsRun = userOwnedOpps.filter(o => o.inspection_outcome).length
  const totalSales = userOwnedOpps.filter(o => o.inspection_outcome === 'sale').length
  const closeRate = totalInspectionsRun > 0 ? (totalSales / totalInspectionsRun * 100).toFixed(1) : '0'

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
    closeRate: parseFloat(closeRate),
    doorsKnockedThisWeek: doorsKnocked,
    contactsThisWeek: contacts,
    inspectionsSetThisWeek: inspectionsSet,
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
      />
    </div>
  )
}
