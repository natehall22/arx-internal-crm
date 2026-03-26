import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  fetchOrgAppointmentTypesFromTable,
  getInspectionDurationFromTable,
} from '@/lib/org-appointment-types'

export const dynamic = 'force-dynamic'

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

    const adminClient = getAdminClient()

    // Get user profile - try with visibility setting first, fall back if column doesn't exist
    let profile: any = null
    
    const { data: profileData, error: profileError } = await adminClient
      .from('users')
      .select('role, org_id, team_id, region_id, canvass_pin_visibility, full_name')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile query error:', profileError)
      // If canvass_pin_visibility column doesn't exist, try without it
      const { data: fallbackProfile } = await adminClient
        .from('users')
        .select('role, org_id, team_id, region_id, full_name')
        .eq('id', user.id)
        .single()
      
      if (fallbackProfile) {
        profile = { ...fallbackProfile, canvass_pin_visibility: 'org' }
      }
    } else {
      profile = profileData
    }

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Get org settings for dispositions
    const { data: org } = await adminClient
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    // Determine which user IDs' leads to show based on visibility setting
    let visibleUserIds: string[] = []
    const visibility = profile.canvass_pin_visibility || 'org'
    const isManager = ['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)
    
    if (isManager || visibility === 'org') {
      // Managers and 'org' visibility see all leads in org
      visibleUserIds = [] // Empty means no filter - get all org leads
    } else if (visibility === 'own') {
      // Only their own leads
      visibleUserIds = [user.id]
    } else if (visibility === 'team') {
      // Get all users in the same team
      if (profile.team_id) {
        const { data: teamUsers } = await adminClient
          .from('users')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('team_id', profile.team_id)
        const teamIds = teamUsers?.map(u => u.id) || []
        // Always include current user's leads
        visibleUserIds = Array.from(new Set([user.id, ...teamIds]))
      } else {
        visibleUserIds = [user.id] // No team, fall back to own
      }
    } else if (visibility === 'region') {
      // Get all users in the same region
      if (profile.region_id) {
        const { data: regionUsers } = await adminClient
          .from('users')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('region_id', profile.region_id)
        const regionIds = regionUsers?.map(u => u.id) || []
        // Always include current user's leads
        visibleUserIds = Array.from(new Set([user.id, ...regionIds]))
      } else if (profile.team_id) {
        // Get region from team
        const { data: team } = await adminClient
          .from('teams')
          .select('region_id')
          .eq('id', profile.team_id)
          .single()
        
        if (team?.region_id) {
          const { data: regionUsers } = await adminClient
            .from('users')
            .select('id')
            .eq('org_id', profile.org_id)
            .eq('region_id', team.region_id)
          const regionIds = regionUsers?.map(u => u.id) || []
          // Always include current user's leads
          visibleUserIds = Array.from(new Set([user.id, ...regionIds]))
        } else {
          visibleUserIds = [user.id]
        }
      } else {
        visibleUserIds = [user.id] // No region or team, fall back to own
      }
    }

    // Build leads query with visibility filter
    let leadsQuery = adminClient
      .from('leads')
      .select('*, owner:users!leads_owner_user_id_fkey(id, full_name)')
      .eq('org_id', profile.org_id)
      .not('lat', 'is', null)
      .not('lng', 'is', null)
    
    // Apply user filter if not showing all org leads
    if (visibleUserIds.length > 0) {
      leadsQuery = leadsQuery.in('owner_user_id', visibleUserIds)
    }

    const { data: leads, error: leadsError } = await leadsQuery

    if (leadsError) {
      console.error('Leads error:', leadsError)
    }
    
    console.log('Canvass data: returning', leads?.length || 0, 'leads, visibility:', visibility, 'filter:', visibleUserIds.length > 0 ? visibleUserIds : 'all')

    // Get users for closer selection - only users who can receive appointments
    // Filter to sales roles and users who have can_receive_appointments = true (or null for backwards compat)
    const { data: users, error: usersError } = await adminClient
      .from('users')
      .select('id, full_name, role, can_receive_appointments, active')
      .eq('org_id', profile.org_id)
      .order('full_name', { ascending: true })
    
    console.log('Users query result:', { count: users?.length, usersError, orgId: profile.org_id, users: users?.map(u => ({ name: u.full_name, active: u.active })) })

    // Show all active users unless they have explicitly opted out via can_receive_appointments = false
    // Debug logging
    console.log('All users before filtering:', users?.map(u => ({ 
      name: u.full_name, 
      role: u.role, 
      can_receive: u.can_receive_appointments
    })))
    
    const filteredUsers = (users || []).filter(u => {
      // Only exclude if explicitly set to false
      // Include everyone else (true, null, undefined)
      return u.can_receive_appointments !== false
    })
    
    console.log('Filtered users for closer selection:', filteredUsers.map(u => u.full_name))

    // Check which users have Google Calendar connected
    const { data: calendarTokens } = await adminClient
      .from('user_google_tokens')
      .select('user_id')
    
    const usersWithCalendarStatus = filteredUsers.map(user => ({
      ...user,
      has_calendar: calendarTokens?.some(t => t.user_id === user.id) || false,
    }))
    
    // Get teams for round-robin option
    const { data: teams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .order('name', { ascending: true })
    
    console.log('Teams query result:', { teams, teamsError, orgId: profile.org_id })

    // Same rule as /api/canvass/lead: first active inspection-type row by sort_order (Admin → Scheduling)
    const appointmentTypeRows = await fetchOrgAppointmentTypesFromTable(adminClient, profile.org_id)
    const inspectionDuration = getInspectionDurationFromTable(appointmentTypeRows, 60)

    console.log('Canvass data response:', {
      leadsCount: leads?.length || 0,
      usersCount: usersWithCalendarStatus?.length || 0,
      teamsCount: teams?.length || 0,
      filteredUsersCount: filteredUsers?.length || 0,
    })

    return NextResponse.json({
      leads: leads || [],
      users: usersWithCalendarStatus,
      teams: teams || [],
      currentUserRole: profile.role,
      currentUserId: user.id,
      currentUserName: profile.full_name || user.email,
      orgId: profile.org_id,
      orgSettings: org?.settings || {},
      pinVisibility: visibility,
      inspectionDuration,
    })
  } catch (err) {
    console.error('Canvass data error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
