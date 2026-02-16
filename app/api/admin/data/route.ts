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

async function getAuthenticatedUser(req: NextRequest) {
  const { client: authClient, accessToken } = getAuthClient(req)
  
  if (!accessToken) {
    return { error: 'Unauthorized', status: 401 }
  }
  
  const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
  if (userError || !user) {
    return { error: 'Unauthorized', status: 401 }
  }

  const adminClient = getAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('org_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) {
    return { error: 'User profile not found', status: 404 }
  }

  // Check admin access for most operations
  const isAdmin = ['admin', 'regional_manager', 'sales_manager'].includes(profile.role)

  return { user, profile, adminClient, isAdmin }
}

// GET - Fetch admin data
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { profile, adminClient, isAdmin } = auth
    const { searchParams } = new URL(request.url)
    const resource = searchParams.get('resource')

    if (!isAdmin) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Regions
    if (resource === 'regions') {
      const { data, error } = await adminClient
        .from('regions')
        .select('*, teams(*)')
        .eq('org_id', profile.org_id)
        .order('name')

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ regions: data || [] })
    }

    // Teams
    if (resource === 'teams') {
      const regionId = searchParams.get('region_id')
      let query = adminClient
        .from('teams')
        .select('*, regions(*)')
        .eq('org_id', profile.org_id)
        .order('name')

      if (regionId) {
        query = query.eq('region_id', regionId)
      }

      const { data: teams, error } = await query

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // Get members for each team
      const teamsWithMembers = []
      for (const team of teams || []) {
        const { data: members } = await adminClient
          .from('users')
          .select('*')
          .eq('team_id', team.id)
          .eq('active', true)
          .order('full_name')

        teamsWithMembers.push({
          ...team,
          members: members || []
        })
      }

      // Also get regions for the form
      const { data: regions } = await adminClient
        .from('regions')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      return NextResponse.json({ teams: teamsWithMembers, regions: regions || [] })
    }

    // Comp Plans
    if (resource === 'comp_plans') {
      const { data: plans } = await adminClient
        .from('comp_plans')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      const { data: assignments } = await adminClient
        .from('user_comp_plans')
        .select('*, users(full_name, role), comp_plans(name)')
        .eq('org_id', profile.org_id)
        .order('effective_from', { ascending: false })

      const { data: users } = await adminClient
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', profile.org_id)
        .eq('active', true)

      return NextResponse.json({
        compPlans: plans || [],
        userAssignments: assignments || [],
        users: users || []
      })
    }

    // Users
    if (resource === 'users') {
      const { data: users, error } = await adminClient
        .from('users')
        .select('*, teams(name), regions(name)')
        .eq('org_id', profile.org_id)
        .order('full_name')

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      const { data: teams } = await adminClient
        .from('teams')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      const { data: regions } = await adminClient
        .from('regions')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      return NextResponse.json({ 
        users: users || [], 
        teams: teams || [],
        regions: regions || []
      })
    }

    // Campaigns
    if (resource === 'campaigns') {
      const { data: campaigns, error } = await adminClient
        .from('campaigns')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ campaigns: campaigns || [] })
    }

    // Scheduling
    if (resource === 'scheduling') {
      const { data: schedules, error } = await adminClient
        .from('schedules')
        .select('*, users(full_name)')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      if (error && !error.message.includes('does not exist')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ schedules: schedules || [] })
    }

    // Subs/Subcontractors
    if (resource === 'subs') {
      const { data: subs, error } = await adminClient
        .from('subcontractors')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      if (error && !error.message.includes('does not exist')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ subs: subs || [] })
    }

    // Dashboard Settings
    if (resource === 'dashboard_settings') {
      const { data: org } = await adminClient
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single()

      return NextResponse.json({ 
        dashboardSettings: org?.settings?.dashboard || {},
        orgId: profile.org_id
      })
    }

    // Proposals/Templates
    if (resource === 'proposals') {
      const { data: templates, error } = await adminClient
        .from('proposal_templates')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      if (error && !error.message.includes('does not exist')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ templates: templates || [] })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to load data' 
    }, { status: 500 })
  }
}

// POST - Create admin data
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { profile, adminClient, isAdmin } = auth

    if (!isAdmin) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { resource, ...data } = body

    // Create Region
    if (resource === 'region') {
      const { error } = await adminClient
        .from('regions')
        .insert({ name: data.name, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Team
    if (resource === 'team') {
      const { error } = await adminClient
        .from('teams')
        .insert({ 
          name: data.name, 
          org_id: profile.org_id,
          region_id: data.region_id || null,
          timezone: data.timezone || 'America/New_York'
        })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Comp Plan
    if (resource === 'comp_plan') {
      const planData = {
        org_id: profile.org_id,
        name: data.name,
        description: data.description || null,
        plan_type: data.plan_type,
        flat_amount: data.flat_amount || null,
        base_percentage: data.base_percentage || null,
        tiers: data.tiers || null,
        volume_bonuses: data.volume_bonuses || null,
        is_manager_plan: data.is_manager_plan || false,
        personal_sales_enabled: data.personal_sales_enabled,
        team_override_enabled: data.team_override_enabled || false,
        team_overrides: data.team_overrides || null,
        applicable_roles: data.applicable_roles || ['sales_rep', 'canvasser'],
        is_active: data.is_active ?? true,
        is_default: data.is_default || false,
      }

      const { error } = await adminClient
        .from('comp_plans')
        .insert(planData)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // If setting as default, unset other defaults
      if (data.is_default) {
        await adminClient
          .from('comp_plans')
          .update({ is_default: false })
          .eq('org_id', profile.org_id)
          .neq('name', data.name)
      }

      return NextResponse.json({ success: true })
    }

    // Assign Comp Plan to User
    if (resource === 'user_comp_plan') {
      const { error } = await adminClient
        .from('user_comp_plans')
        .insert({
          org_id: profile.org_id,
          user_id: data.user_id,
          comp_plan_id: data.comp_plan_id,
          effective_from: data.effective_from,
          override_percentage: data.override_percentage || null,
        })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Campaign
    if (resource === 'campaign') {
      const { error } = await adminClient
        .from('campaigns')
        .insert({ ...data, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Subcontractor
    if (resource === 'sub') {
      const { error } = await adminClient
        .from('subcontractors')
        .insert({ ...data, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Proposal Template
    if (resource === 'proposal_template') {
      const { error } = await adminClient
        .from('proposal_templates')
        .insert({ ...data, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create' 
    }, { status: 500 })
  }
}

// PATCH - Update admin data
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { profile, adminClient, isAdmin } = auth

    if (!isAdmin) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { resource, id, ...data } = body

    // Update Region
    if (resource === 'region') {
      const { error } = await adminClient
        .from('regions')
        .update({ name: data.name })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Team
    if (resource === 'team') {
      const { error } = await adminClient
        .from('teams')
        .update({ 
          name: data.name,
          region_id: data.region_id || null,
          timezone: data.timezone || 'America/New_York'
        })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Comp Plan
    if (resource === 'comp_plan') {
      const planData = {
        name: data.name,
        description: data.description || null,
        plan_type: data.plan_type,
        flat_amount: data.flat_amount || null,
        base_percentage: data.base_percentage || null,
        tiers: data.tiers || null,
        volume_bonuses: data.volume_bonuses || null,
        is_manager_plan: data.is_manager_plan || false,
        personal_sales_enabled: data.personal_sales_enabled,
        team_override_enabled: data.team_override_enabled || false,
        team_overrides: data.team_overrides || null,
        applicable_roles: data.applicable_roles || ['sales_rep', 'canvasser'],
        is_active: data.is_active ?? true,
        is_default: data.is_default || false,
      }

      const { error } = await adminClient
        .from('comp_plans')
        .update(planData)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // If setting as default, unset other defaults
      if (data.is_default) {
        await adminClient
          .from('comp_plans')
          .update({ is_default: false })
          .eq('org_id', profile.org_id)
          .neq('id', id)
      }

      return NextResponse.json({ success: true })
    }

    // Update User
    if (resource === 'user') {
      const { error } = await adminClient
        .from('users')
        .update(data)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Campaign
    if (resource === 'campaign') {
      const { error } = await adminClient
        .from('campaigns')
        .update(data)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Dashboard Settings
    if (resource === 'dashboard_settings') {
      const { data: org } = await adminClient
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single()

      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...org?.settings,
            dashboard: data.dashboard,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Subcontractor
    if (resource === 'sub') {
      const { error } = await adminClient
        .from('subcontractors')
        .update(data)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Proposal Template
    if (resource === 'proposal_template') {
      const { error } = await adminClient
        .from('proposal_templates')
        .update(data)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update' 
    }, { status: 500 })
  }
}

// DELETE - Delete admin data
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { profile, adminClient, isAdmin } = auth

    if (!isAdmin) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const resource = searchParams.get('resource')
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    // Delete Region
    if (resource === 'region') {
      const { error } = await adminClient
        .from('regions')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Team
    if (resource === 'team') {
      const { error } = await adminClient
        .from('teams')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Comp Plan
    if (resource === 'comp_plan') {
      const { error } = await adminClient
        .from('comp_plans')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete User Comp Plan Assignment
    if (resource === 'user_comp_plan') {
      const { error } = await adminClient
        .from('user_comp_plans')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Campaign
    if (resource === 'campaign') {
      const { error } = await adminClient
        .from('campaigns')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Subcontractor
    if (resource === 'sub') {
      const { error } = await adminClient
        .from('subcontractors')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Proposal Template
    if (resource === 'proposal_template') {
      const { error } = await adminClient
        .from('proposal_templates')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete' 
    }, { status: 500 })
  }
}
