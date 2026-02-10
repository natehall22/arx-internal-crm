export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  // Determine user scope for data access
  const isAdmin = profile.role === 'admin'
  const isRegionalManager = profile.role === 'regional_manager'
  const isSalesManager = profile.role === 'sales_manager'
  const isSalesRep = profile.role === 'sales_rep'
  const isCanvasser = profile.role === 'canvasser'

  // Get dashboard settings (cascade: user -> team -> region -> org)
  let dashboardSettings = null
  
  // Try user-specific settings first
  const { data: userSettings } = await supabase
    .from('dashboard_settings')
    .select('*')
    .eq('org_id', profile.org_id)
    .eq('user_id', profile.id)
    .single()
  
  if (userSettings) {
    dashboardSettings = userSettings.settings
  } else if (profile.team_id) {
    // Try team settings
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
    // Try region settings
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

  // Default settings
  const settings = dashboardSettings || {
    widgets: ['stats', 'progress', 'appointments', 'activity'],
    goals: { doors_knocked: 100, inspections: 20, sales: 5 },
  }

  // Get user's team members if they're a manager
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
    // Admin sees all
    teamMemberIds = []
  }

  // Build queries based on scope
  const buildScopedQuery = (table: string, baseQuery: any) => {
    if (isAdmin) return baseQuery
    if (teamMemberIds.length > 0) {
      return baseQuery.in('owner_user_id', teamMemberIds)
    }
    return baseQuery.eq('owner_user_id', profile.id)
  }

  // Get leads stats
  let leadsQuery = supabase
    .from('leads')
    .select('status, canvass_disposition, created_at, owner_user_id')
    .eq('org_id', profile.org_id)
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      leadsQuery = leadsQuery.in('owner_user_id', teamMemberIds)
    } else {
      leadsQuery = leadsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { data: leads } = await leadsQuery

  // Get opportunities
  let oppsQuery = supabase
    .from('opportunities')
    .select('status, inspection_outcome, created_at, owner_user_id')
    .eq('org_id', profile.org_id)
  
  if (!isAdmin) {
    if (teamMemberIds.length > 1) {
      oppsQuery = oppsQuery.in('owner_user_id', teamMemberIds)
    } else {
      oppsQuery = oppsQuery.eq('owner_user_id', profile.id)
    }
  }
  const { data: opportunities } = await oppsQuery

  // Get projects
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

  // Get pending status prompts for closers
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

  // Get upcoming appointments
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

  // Get recent activities
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

  // Calculate metrics
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  startOfWeek.setHours(0, 0, 0, 0)

  const thisWeekLeads = leads?.filter(l => new Date(l.created_at) >= startOfWeek) || []
  const doorsKnocked = thisWeekLeads.length
  const contacts = thisWeekLeads.filter(l => 
    ['go_back', 'hot_lead', 'not_interested', 'renter'].includes(l.canvass_disposition || '')
  ).length
  const inspectionsSet = opportunities?.filter(o => new Date(o.created_at) >= startOfWeek).length || 0
  const salesThisWeek = opportunities?.filter(o => 
    o.inspection_outcome === 'sale' && new Date(o.created_at) >= startOfWeek
  ).length || 0

  // Calculate close rate
  const totalInspectionsRun = opportunities?.filter(o => o.inspection_outcome).length || 0
  const totalSales = opportunities?.filter(o => o.inspection_outcome === 'sale').length || 0
  const closeRate = totalInspectionsRun > 0 ? (totalSales / totalInspectionsRun * 100).toFixed(1) : '0'

  // Progress toward goals
  const goals = settings.goals || { doors_knocked: 100, inspections: 20, sales: 5 }
  const progress = {
    doors_knocked: { current: doorsKnocked, goal: goals.doors_knocked },
    contacts: { current: contacts, goal: Math.round(goals.doors_knocked * 0.3) },
    inspections: { current: inspectionsSet, goal: goals.inspections },
    sales: { current: salesThisWeek, goal: goals.sales },
  }

  // Stats summary
  const stats = {
    totalLeads: leads?.length || 0,
    newLeads: leads?.filter(l => l.status === 'new').length || 0,
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
      />
    </div>
  )
}
