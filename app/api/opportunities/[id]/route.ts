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

// GET - Get a single opportunity
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const { data: opportunity, error } = await adminClient
      .from('opportunities')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (error || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    return NextResponse.json({ opportunity })
  } catch (error) {
    console.error('Opportunity GET error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch opportunity' 
    }, { status: 500 })
  }
}

// PATCH - Update an opportunity
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const body = await request.json()

    const { data: opportunity, error } = await adminClient
      .from('opportunities')
      .update(body)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) {
      console.error('Opportunity update error:', error)
      return NextResponse.json({ error: 'Failed to update opportunity' }, { status: 500 })
    }

    return NextResponse.json({ opportunity })
  } catch (error) {
    console.error('Opportunity PATCH error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update opportunity' 
    }, { status: 500 })
  }
}

// DELETE - Delete an opportunity (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Only admins can delete opportunities
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete opportunities' }, { status: 403 })
    }

    // First, check if the opportunity exists and belongs to the org
    const { data: opportunity, error: fetchError } = await adminClient
      .from('opportunities')
      .select('id, lead_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Delete related records first (if any)
    // Delete proposals linked to this opportunity
    await adminClient
      .from('proposals')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete projects linked to this opportunity
    await adminClient
      .from('projects')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete activities linked to this opportunity
    await adminClient
      .from('activities')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete appointments linked to this opportunity
    await adminClient
      .from('appointments')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete roof measurements linked to this opportunity
    await adminClient
      .from('roof_measurements')
      .delete()
      .eq('opportunity_id', params.id)

    // Now delete the opportunity
    const { error: deleteError } = await adminClient
      .from('opportunities')
      .delete()
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Opportunity delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete opportunity' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Opportunity DELETE error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete opportunity' 
    }, { status: 500 })
  }
}
