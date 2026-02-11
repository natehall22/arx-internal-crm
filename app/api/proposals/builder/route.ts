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

// GET - Load builder data (pricebook items, templates, opportunity, measurement)
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
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const opportunityId = searchParams.get('opportunity_id')
    const measurementId = searchParams.get('measurement_id')

    // Load pricebook items
    const { data: items } = await adminClient
      .from('pricebook_items')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('category')
      .order('name')

    // Filter based on visibility
    const visibleItems = (items || []).filter((item: any) => {
      if (!item.visibility || item.visibility === 'all' || item.visibility === 'sales_reps') return true
      if (item.visibility === 'managers' && ['admin', 'regional_manager', 'sales_manager', 'manager'].includes(profile.role)) return true
      if (item.visibility === 'admin_only' && profile.role === 'admin') return true
      return false
    })

    // Load templates
    const { data: templates } = await adminClient
      .from('proposal_templates')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('active', true)

    // Load opportunity data if provided
    let opportunity = null
    if (opportunityId) {
      const { data: opp } = await adminClient
        .from('opportunities')
        .select('*, leads(*)')
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .single()
      opportunity = opp
    }

    // Load measurement data if provided
    let measurement = null
    if (measurementId) {
      const { data: meas } = await adminClient
        .from('roof_measurements')
        .select('*')
        .eq('id', measurementId)
        .single()
      measurement = meas
    }

    return NextResponse.json({
      pricebookItems: visibleItems.filter((i: any) => !i.is_adder),
      adders: visibleItems.filter((i: any) => i.is_adder),
      templates: templates || [],
      opportunity,
      measurement,
      role: profile.role,
      orgId: profile.org_id,
      userId: user.id,
    })
  } catch (error) {
    console.error('Proposal builder data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to load builder data' 
    }, { status: 500 })
  }
}

// POST - Create a new proposal
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
    const { proposal, lineItems } = body

    // Generate proposal number
    const { count } = await adminClient
      .from('proposals')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)

    const proposalNumber = `P-${String((count || 0) + 1).padStart(5, '0')}`

    // Create the proposal
    const { data: newProposal, error: proposalError } = await adminClient
      .from('proposals')
      .insert({
        org_id: profile.org_id,
        created_by: user.id,
        proposal_number: proposalNumber,
        ...proposal,
        status: 'draft',
      })
      .select()
      .single()

    if (proposalError) {
      console.error('Proposal creation error:', proposalError)
      return NextResponse.json({ error: `Failed to create proposal: ${proposalError.message}` }, { status: 400 })
    }

    // Create line items
    if (lineItems && lineItems.length > 0) {
      const lineItemsToInsert = lineItems.map((item: any, index: number) => ({
        proposal_id: newProposal.id,
        pricebook_item_id: item.pricebook_item_id,
        category: item.category,
        name: item.name,
        description: item.description || '',
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        is_adder: item.is_adder || false,
        sort_order: index,
      }))

      const { error: lineItemsError } = await adminClient
        .from('proposal_line_items')
        .insert(lineItemsToInsert)

      if (lineItemsError) {
        console.error('Line items creation error:', lineItemsError)
        // Don't fail the whole request, proposal is already created
      }
    }

    return NextResponse.json({ proposal: newProposal })
  } catch (error) {
    console.error('Proposal builder API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create proposal' 
    }, { status: 500 })
  }
}
