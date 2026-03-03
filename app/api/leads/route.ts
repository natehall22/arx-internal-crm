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

// POST - Create a new lead
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
    
    // Create the lead
    const { data: lead, error: leadError } = await adminClient
      .from('leads')
      .insert({
        org_id: profile.org_id,
        owner_user_id: body.owner_user_id || user.id,
        homeowner_name: body.homeowner_name || null,
        phone: body.phone || null,
        email: body.email || null,
        address_text: body.address_text || null,
        source: body.source || null,
        status: body.status || 'new',
        notes: body.notes || null,
        lat: body.lat || null,
        lng: body.lng || null,
      })
      .select('id')
      .single()

    if (leadError) {
      console.error('Lead creation error:', leadError)
      return NextResponse.json({ error: `Failed to create lead: ${leadError.message}` }, { status: 400 })
    }

    return NextResponse.json({ lead_id: lead.id })
  } catch (error) {
    console.error('Leads API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create lead' 
    }, { status: 500 })
  }
}

// GET - Get leads for the current user's org
// Only shows legitimate leads:
// - Web leads (ad_campaign, call_in, referral, web, other)
// - Door-to-door leads that have converted to opportunities (scheduled inspections)
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

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, team_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Build leads query with role-based filtering
    let leadsQuery = adminClient
      .from('leads')
      .select(`
        *,
        users:users!leads_owner_user_id_fkey(full_name),
        campaigns(name),
        lead_sources(name)
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    // Role-based filtering - setters/canvassers only see their own leads
    const isRep = ['rep', 'sales_rep', 'canvasser', 'setter'].includes(profile.role)
    if (isRep) {
      leadsQuery = leadsQuery.eq('owner_user_id', user.id)
    }

    const { data: allLeads, error: leadsError } = await leadsQuery

    if (leadsError) {
      console.error('Leads fetch error:', leadsError)
      return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })
    }

    // Get all lead IDs that have opportunities (converted door knocks)
    const { data: opportunities } = await adminClient
      .from('opportunities')
      .select('lead_id')
      .eq('org_id', profile.org_id)
      .not('lead_id', 'is', null)

    const leadIdsWithOpportunities = new Set(
      opportunities?.map(o => o.lead_id).filter(Boolean) || []
    )

    // Filter leads:
    // - Include all non-door_to_door leads (web, referral, call_in, etc.)
    // - Include door_to_door leads ONLY if they have an opportunity (converted)
    const filteredLeads = (allLeads || []).filter(lead => {
      // If not door_to_door, always include
      if (lead.source !== 'door_to_door') {
        return true
      }
      
      // For door_to_door leads, only include if they have an opportunity
      // This means they were converted (hot lead with scheduled inspection)
      return leadIdsWithOpportunities.has(lead.id)
    })

    return NextResponse.json({ leads: filteredLeads })
  } catch (error) {
    console.error('Leads API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch leads' 
    }, { status: 500 })
  }
}
