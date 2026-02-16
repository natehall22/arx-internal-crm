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

// GET - Load integrations
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

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    if (!['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get integrations
    const { data: integrations } = await adminClient
      .from('integrations')
      .select('*')
      .eq('org_id', profile.org_id)

    // Get org settings for webhook configuration
    const { data: org } = await adminClient
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    return NextResponse.json({
      integrations: integrations || [],
      orgId: profile.org_id,
      settings: org?.settings || {},
    })
  } catch (error) {
    console.error('Integrations API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to load integrations' 
    }, { status: 500 })
  }
}

// POST - Create/Enable integration
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

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || !['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { provider, api_key, settings } = body

    // Check if integration already exists
    const { data: existing } = await adminClient
      .from('integrations')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('provider', provider)
      .single()

    if (existing) {
      // Update existing
      const { error } = await adminClient
        .from('integrations')
        .update({
          api_key,
          settings,
          is_enabled: true,
        })
        .eq('id', existing.id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    } else {
      // Create new
      const { error } = await adminClient
        .from('integrations')
        .insert({
          org_id: profile.org_id,
          provider,
          api_key,
          settings,
          is_enabled: true,
        })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Integrations API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to save integration' 
    }, { status: 500 })
  }
}

// PATCH - Update integration
export async function PATCH(request: NextRequest) {
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

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || !['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { id, provider, is_enabled, api_key, settings } = body

    if (id) {
      // Update by ID
      const { error } = await adminClient
        .from('integrations')
        .update({ is_enabled, api_key, settings })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    } else if (provider) {
      // Update by provider
      const { error } = await adminClient
        .from('integrations')
        .update({ is_enabled, api_key, settings })
        .eq('provider', provider)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Integrations API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update integration' 
    }, { status: 500 })
  }
}

// DELETE - Disable/Remove integration
export async function DELETE(request: NextRequest) {
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

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || !['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider')

    if (!provider) {
      return NextResponse.json({ error: 'Provider required' }, { status: 400 })
    }

    // Disable integration (don't delete, just disable)
    const { error } = await adminClient
      .from('integrations')
      .update({ is_enabled: false })
      .eq('provider', provider)
      .eq('org_id', profile.org_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Integrations API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to disable integration' 
    }, { status: 500 })
  }
}
