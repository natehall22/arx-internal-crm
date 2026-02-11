import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(singleCookie.value)
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
      return JSON.parse(chunks.join(''))
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

    // Get user profile with visibility setting
    const { data: profile } = await adminClient
      .from('users')
      .select('role, org_id, team_id, region_id, canvass_pin_visibility')
      .eq('id', user.id)
      .single()

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
        visibleUserIds = teamUsers?.map(u => u.id) || [user.id]
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
        visibleUserIds = regionUsers?.map(u => u.id) || [user.id]
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
          visibleUserIds = regionUsers?.map(u => u.id) || [user.id]
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

    // Get users for closer selection
    const { data: users } = await adminClient
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', profile.org_id)
      .order('full_name', { ascending: true })

    return NextResponse.json({
      leads: leads || [],
      users: users || [],
      currentUserRole: profile.role,
      orgSettings: org?.settings || {},
      pinVisibility: visibility,
    })
  } catch (err) {
    console.error('Canvass data error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
