import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

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

// GET - Fetch dashboard settings and related data
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

    const adminClient = createServiceClient()

    // Get user profile
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('id, org_id, role, region_id, team_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Check permissions
    if (!['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const scope = searchParams.get('scope') || 'org'
    const regionId = searchParams.get('region_id')
    const teamId = searchParams.get('team_id')

    // Fetch regions and teams
    const { data: regions } = await adminClient
      .from('regions')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .order('name')

    const { data: teams } = await adminClient
      .from('teams')
      .select('id, name, region_id, regions(name)')
      .eq('org_id', profile.org_id)
      .order('name')

    // Fetch settings based on scope
    let settingsQuery = adminClient
      .from('dashboard_settings')
      .select('*')
      .eq('org_id', profile.org_id)

    if (scope === 'org') {
      settingsQuery = settingsQuery.is('region_id', null).is('team_id', null).is('user_id', null)
    } else if (scope === 'region' && regionId) {
      settingsQuery = settingsQuery.eq('region_id', regionId).is('team_id', null).is('user_id', null)
    } else if (scope === 'team' && teamId) {
      settingsQuery = settingsQuery.eq('team_id', teamId).is('user_id', null)
    }

    const { data: settings, error: settingsError } = await settingsQuery.maybeSingle()

    if (settingsError && !settingsError.message?.includes('No rows found')) {
      console.error('Settings fetch error:', settingsError)
    }

    return NextResponse.json({
      profile,
      regions: regions || [],
      teams: teams || [],
      settings: settings || null,
    })
  } catch (error) {
    console.error('Dashboard settings GET error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch settings' 
    }, { status: 500 })
  }
}

// POST - Save dashboard settings
export async function POST(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Get user profile
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('id, org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Check permissions
    if (!['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { scope, region_id, team_id, settings, existing_id } = body

    if (!settings) {
      return NextResponse.json({ error: 'Settings data required' }, { status: 400 })
    }

    // Validate scope
    if (scope === 'region' && !region_id) {
      return NextResponse.json({ error: 'Region ID required for region scope' }, { status: 400 })
    }
    if (scope === 'team' && !team_id) {
      return NextResponse.json({ error: 'Team ID required for team scope' }, { status: 400 })
    }

    if (existing_id) {
      // Update existing settings
      const { data, error } = await adminClient
        .from('dashboard_settings')
        .update({ 
          settings, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', existing_id)
        .eq('org_id', profile.org_id)
        .select()
        .single()

      if (error) {
        console.error('Update error:', error)
        return NextResponse.json({ error: `Failed to update settings: ${error.message}` }, { status: 500 })
      }

      return NextResponse.json({ success: true, settings: data })
    } else {
      // Create new settings
      const settingsData = {
        org_id: profile.org_id,
        region_id: scope === 'region' ? region_id : null,
        team_id: scope === 'team' ? team_id : null,
        user_id: null,
        settings,
      }

      const { data, error } = await adminClient
        .from('dashboard_settings')
        .insert(settingsData)
        .select()
        .single()

      if (error) {
        console.error('Insert error:', error)
        // Check if it's a unique constraint violation
        if (error.message?.includes('duplicate') || error.message?.includes('unique')) {
          return NextResponse.json({ 
            error: 'Settings already exist for this scope. Please refresh and try again.' 
          }, { status: 409 })
        }
        return NextResponse.json({ error: `Failed to create settings: ${error.message}` }, { status: 500 })
      }

      return NextResponse.json({ success: true, settings: data })
    }
  } catch (error) {
    console.error('Dashboard settings POST error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to save settings' 
    }, { status: 500 })
  }
}
