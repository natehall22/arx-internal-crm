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

// GET - Get opportunities (optionally filtered by lead_ids)
export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized - no access token' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      console.error('Auth error:', userError)
      return NextResponse.json({ error: 'Unauthorized - invalid token' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    // Get user profile for org_id
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 })
    }

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found - no org_id' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const leadIds = searchParams.get('lead_ids')
    const fullData = searchParams.get('full') === 'true'

    // Build the query - fetch all columns explicitly to avoid join issues
    let query = adminClient
      .from('opportunities')
      .select(`
        id,
        org_id,
        lead_id,
        customer_id,
        owner_user_id,
        address_text,
        project_type,
        status,
        created_at,
        updated_at
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (leadIds) {
      const ids = leadIds.split(',').filter(Boolean)
      if (ids.length > 0) {
        query = query.in('lead_id', ids)
      }
    }

    const { data: opportunities, error: oppsError } = await query

    if (oppsError) {
      console.error('Opportunities fetch error:', oppsError)
      // Handle case where table doesn't exist yet
      if (oppsError.message?.includes('does not exist') || oppsError.message?.includes('schema cache')) {
        return NextResponse.json({ 
          opportunities: [],
          warning: 'Opportunities table not found. Please run database migrations.'
        })
      }
      return NextResponse.json({ error: `Failed to fetch opportunities: ${oppsError.message}` }, { status: 500 })
    }

    // Fetch related data separately to avoid join issues
    if (fullData && opportunities && opportunities.length > 0) {
      // Get unique IDs for related lookups
      const ownerIdList = opportunities.map((o: any) => o.owner_user_id).filter(Boolean)
      const leadIdList = opportunities.map((o: any) => o.lead_id).filter(Boolean)
      const customerIdList = opportunities.map((o: any) => o.customer_id).filter(Boolean)
      
      // Fetch owners
      if (ownerIdList.length > 0) {
        const { data: owners } = await adminClient
          .from('users')
          .select('id, full_name')
          .in('id', ownerIdList)

        const ownerMap: Record<string, string> = {}
        ;(owners || []).forEach((u: any) => { ownerMap[u.id] = u.full_name })
        
        opportunities.forEach((opp: any) => {
          opp.users = opp.owner_user_id ? { full_name: ownerMap[opp.owner_user_id] || null } : null
        })
      }
      
      // Fetch leads
      if (leadIdList.length > 0) {
        const { data: leads } = await adminClient
          .from('leads')
          .select('id, homeowner_name')
          .in('id', leadIdList)

        const leadMap: Record<string, string> = {}
        ;(leads || []).forEach((l: any) => { leadMap[l.id] = l.homeowner_name })
        
        opportunities.forEach((opp: any) => {
          opp.leads = opp.lead_id ? { homeowner_name: leadMap[opp.lead_id] || null } : null
        })
      }
      
      // Fetch customers
      if (customerIdList.length > 0) {
        const { data: customers } = await adminClient
          .from('customers')
          .select('id, name')
          .in('id', customerIdList)

        const customerMap: Record<string, string> = {}
        ;(customers || []).forEach((c: any) => { customerMap[c.id] = c.name })
        
        opportunities.forEach((opp: any) => {
          opp.customers = opp.customer_id ? { name: customerMap[opp.customer_id] || null } : null
        })
      }
    }

    return NextResponse.json({ opportunities: opportunities || [] })
  } catch (error) {
    console.error('Opportunities API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch opportunities' 
    }, { status: 500 })
  }
}
