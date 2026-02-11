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

// GET - Get a single proposal with all details
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

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Get proposal with creator info
    const { data: proposal, error: proposalError } = await adminClient
      .from('proposals')
      .select('*, users:created_by(full_name, email, phone)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Get company info
    const { data: company } = await adminClient
      .from('orgs')
      .select('name, logo_url, phone, email, address, website')
      .eq('id', profile.org_id)
      .single()

    // Get line items
    const { data: lineItems } = await adminClient
      .from('proposal_line_items')
      .select('*')
      .eq('proposal_id', params.id)
      .order('sort_order')

    // Get measurement data if opportunity exists
    let measurement = null
    if (proposal.opportunity_id) {
      const { data: measurementData } = await adminClient
        .from('roof_measurements')
        .select('*')
        .eq('opportunity_id', proposal.opportunity_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      measurement = measurementData
    }

    return NextResponse.json({
      proposal,
      lineItems: lineItems || [],
      company,
      rep: proposal.users,
      measurement,
      role: profile.role,
    })
  } catch (error) {
    console.error('Proposal detail API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch proposal' 
    }, { status: 500 })
  }
}

// PATCH - Update proposal (status, send, etc.)
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

    // Update proposal
    const { data: proposal, error: updateError } = await adminClient
      .from('proposals')
      .update(body)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError) {
      console.error('Proposal update error:', updateError)
      return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
    }

    return NextResponse.json({ proposal })
  } catch (error) {
    console.error('Proposal update API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update proposal' 
    }, { status: 500 })
  }
}
