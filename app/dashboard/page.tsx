export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import DashboardClient from './DashboardClient'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'

export default async function DashboardPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  // Redirect ops-only users to ops dashboard
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

  let leadsQuery = supabase
    .from('leads')
    .select('id, status, source, canvass_disposition, created_at, owner_user_id')
    .eq('org_id', profile.org_id)
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      leadsQuery = leadsQuery.in('owner_user_id', teamMemberIds)
    } else {
      leadsQuery = leadsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { data: allLeads, error: leadsError } = await leadsQuery

  let oppsQuery = supabase
    .from('opportunities')
    .select('lead_id, status, inspection_outcome, created_at, owner_user_id, setter_user_id')
    .eq('org_id', profile.org_id)
  
  // For opportunities, we need all org opportunities to properly attribute:
  // - inspections_set to setter_user_id
  // - sales/close_rate to owner_user_id (closer)
  // So we don't filter by owner_user_id here for non-admins
  const { data: opportunities } = await oppsQuery

  // Fetch scheduled_appointments for accurate inspection attribution
  // canvasser_user_id = the setter who scheduled the inspection (SOURCE OF TRUTH)
  const { data: allAppointments } = await supabase
    .from('scheduled_appointments')
    .select('id, canvasser_user_id, lead_id, created_at')
    .eq('org_id', profile.org_id)

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

  // Calculate week start date using shared utility
  // Uses America/New_York timezone with Sunday as week start
  const { start: startOfWeek } = getDateRangeForTimeFrame('week', 'America/New_York')

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
      for (const member of members) {
        const memberLeads = allLeads?.filter(l => l.owner_user_id === member.id) || []
        
        // Inspections OWNED by this member (closer gets credit for sales)
        const memberOwnedOpps = opportunities?.filter(o => o.owner_user_id === member.id) || []
        
        // Count doors knocked - all leads created this week
        const memberWeekLeads = memberLeads.filter(l => 
          new Date(l.created_at) >= startOfWeek
        )
        const rawDoors = memberWeekLeads.length
        
        // Count contacts - only dispositions where they talked to someone
        const rawContacts = memberWeekLeads.filter(l => 
          l.canvass_disposition && contactDispositions.includes(l.canvass_disposition)
        ).length
        
        // Inspections set this week - from scheduled_appointments.canvasser_user_id (SOURCE OF TRUTH)
        const memberWeekAppointments = allAppointments?.filter(a => 
          a.canvasser_user_id === member.id && new Date(a.created_at) >= startOfWeek
        ) || []
        const inspectionsSet = memberWeekAppointments.length
        
        // Calculate bonus doors/contacts from inspections
        // Bonus = inspections that weren't already counted via a lead owned by this user
        const inspectionBonusDoors = memberWeekAppointments.filter(a => {
          if (!a.lead_id) return true
          const lead = memberWeekLeads.find(l => l.id === a.lead_id)
          return !lead
        }).length
        
        const inspectionBonusContacts = memberWeekAppointments.filter(a => {
          if (!a.lead_id) return true
          const lead = memberWeekLeads.find(l => l.id === a.lead_id)
          if (!lead) return true
          return !contactDispositions.includes(lead.canvass_disposition || '')
        }).length
        
        const finalDoors = rawDoors + inspectionBonusDoors
        const finalContacts = rawContacts + inspectionBonusContacts
        
        // Sales this week - credit goes to CLOSER (owner)
        const memberWeekSales = memberOwnedOpps.filter(o => 
          o.inspection_outcome === 'sale' && new Date(o.created_at) >= startOfWeek
        )
        
        // Close rate based on inspections run this week by this closer
        const weekInspectionsRun = memberOwnedOpps.filter(o => 
          o.inspection_outcome && new Date(o.created_at) >= startOfWeek
        ).length
        const closeRate = weekInspectionsRun > 0 ? (memberWeekSales.length / weekInspectionsRun * 100) : 0
        
        teamMemberStats.push({
          id: member.id,
          name: member.full_name || 'Unknown',
          role: member.role,
          doorsKnocked: finalDoors,
          contacts: finalContacts,
          inspectionsSet, // Credit to setter via scheduled_appointments.canvasser_user_id
          sales: memberWeekSales.length, // Credit to closer
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

  const thisWeekLeads = allLeads?.filter(l => new Date(l.created_at) >= startOfWeek) || []
  const rawDoorsKnocked = thisWeekLeads.length
  const rawContacts = thisWeekLeads.filter(l => 
    ['go_back', 'hot_lead', 'not_interested', 'renter'].includes(l.canvass_disposition || '')
  ).length
  
  // Inspections set - from scheduled_appointments.canvasser_user_id (SOURCE OF TRUTH)
  const thisWeekAppointments = allAppointments?.filter(a => 
    new Date(a.created_at) >= startOfWeek &&
    (isAdmin || a.canvasser_user_id === profile.id || teamMemberIds.includes(a.canvasser_user_id || ''))
  ) || []
  const inspectionsSet = thisWeekAppointments.length
  
  // Calculate bonus doors/contacts from inspections
  const contactDisps = ['go_back', 'hot_lead', 'not_interested', 'renter']
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
  
  // Sales - credit to closer (filter by owner_user_id for current user)
  const salesThisWeek = opportunities?.filter(o => 
    o.inspection_outcome === 'sale' && 
    new Date(o.created_at) >= startOfWeek &&
    (isAdmin || o.owner_user_id === profile.id || teamMemberIds.includes(o.owner_user_id || ''))
  ).length || 0

  // Close rate based on inspections run by closer (owner)
  const userOwnedOpps = opportunities?.filter(o => 
    isAdmin || o.owner_user_id === profile.id || teamMemberIds.includes(o.owner_user_id || '')
  ) || []
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

  // Filter leads for "Total Leads" count:
  // - Include all non-door_to_door leads (web, referral, call_in, etc.)
  // - Include door_to_door leads ONLY if they have an opportunity (converted)
  const leadIdsWithOpportunities = new Set(
    opportunities?.map(o => o.lead_id).filter(Boolean) || []
  )
  
  const legitimateLeads = (allLeads || []).filter(lead => {
    // If not door_to_door, always include
    if (lead.source !== 'door_to_door') {
      return true
    }
    // For door_to_door leads, only include if they have an opportunity
    return leadIdsWithOpportunities.has(lead.id)
  })

  const stats = {
    totalLeads: legitimateLeads.length,
    newLeads: legitimateLeads.filter(l => l.status === 'new').length,
    totalOpportunities: opportunities?.length || 0,
    openOpportunities: opportunities?.filter(o => o.status === 'open').length || 0,
    totalProjects: projects?.length || 0,
    activeProjects: projects?.filter(p => ['open', 'in_progress'].includes(p.status)).length || 0,
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
