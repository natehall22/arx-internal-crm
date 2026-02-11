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

    const searchParams = request.nextUrl.searchParams
    const leadIds = searchParams.get('lead_ids')
    const fullData = searchParams.get('full') === 'true'

    // Build the query based on what data is needed
    let query = adminClient
      .from('opportunities')
      .select(fullData 
        ? '*, customers(name), leads(homeowner_name)'
        : 'id, lead_id, status, owner_user_id'
      )
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
      return NextResponse.json({ error: 'Failed to fetch opportunities' }, { status: 500 })
    }

    // If full data requested, fetch owner names separately
    if (fullData && opportunities && opportunities.length > 0) {
      const ownerIds = [...new Set(opportunities.map((o: any) => o.owner_user_id).filter(Boolean))]
      
      if (ownerIds.length > 0) {
        const { data: owners } = await adminClient
          .from('users')
          .select('id, full_name')
          .in('id', ownerIds)

        const ownerMap = new Map((owners || []).map((u: any) => [u.id, u.full_name]))
        
        // Add owner info to opportunities
        opportunities.forEach((opp: any) => {
          opp.users = opp.owner_user_id ? { full_name: ownerMap.get(opp.owner_user_id) || null } : null
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
