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

    const supabase = getAdminClient()

    // Get user profile
    const { data: profile } = await supabase
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Only admins can use this debug endpoint
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const userName = searchParams.get('user') || ''
    const timeframe = searchParams.get('timeframe') || 'quarter'

    // Get date range
    const ET_OFFSET_HOURS = 5
    const now = new Date()
    const nowET = new Date(now.getTime() - ET_OFFSET_HOURS * 60 * 60 * 1000)
    
    let start: Date
    let end: Date
    
    if (timeframe === 'quarter') {
      const quarter = Math.floor(nowET.getUTCMonth() / 3)
      start = new Date(Date.UTC(nowET.getUTCFullYear(), quarter * 3, 1, ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    } else if (timeframe === 'month') {
      start = new Date(Date.UTC(nowET.getUTCFullYear(), nowET.getUTCMonth(), 1, ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    } else {
      // Default to all time
      start = new Date(Date.UTC(2020, 0, 1, ET_OFFSET_HOURS, 0, 0, 0))
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    }

    // Find user by name (case insensitive partial match)
    const { data: matchingUsers } = await supabase
      .from('users')
      .select('id, full_name, email, role')
      .eq('org_id', profile.org_id)
      .ilike('full_name', `%${userName}%`)

    if (!matchingUsers || matchingUsers.length === 0) {
      return NextResponse.json({ 
        error: 'No matching users found',
        searchedFor: userName 
      }, { status: 404 })
    }

    const results = []

    for (const targetUser of matchingUsers) {
      // Get all leads owned by this user
      const { data: ownedLeads, error: leadsError } = await supabase
        .from('leads')
        .select('id, created_at, canvass_disposition, source, owner_user_id, status')
        .eq('org_id', profile.org_id)
        .eq('owner_user_id', targetUser.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .order('created_at', { ascending: false })

      // Get all leads where this user is the closer
      const { data: closerLeads } = await supabase
        .from('leads')
        .select('id, created_at, canvass_disposition, source, owner_user_id, closer_user_id, status')
        .eq('org_id', profile.org_id)
        .eq('closer_user_id', targetUser.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())

      // Get opportunities where this user is setter
      const { data: setterOpps } = await supabase
        .from('opportunities')
        .select('id, created_at, status, inspection_outcome, setter_user_id, owner_user_id')
        .eq('org_id', profile.org_id)
        .eq('setter_user_id', targetUser.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())

      // Get opportunities where this user is owner (closer)
      const { data: ownerOpps } = await supabase
        .from('opportunities')
        .select('id, created_at, status, inspection_outcome, setter_user_id, owner_user_id')
        .eq('org_id', profile.org_id)
        .eq('owner_user_id', targetUser.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())

      const contactDispositions = ['go_back', 'hot_lead', 'not_interested', 'renter']

      results.push({
        user: {
          id: targetUser.id,
          name: targetUser.full_name,
          email: targetUser.email,
          role: targetUser.role,
        },
        timeframe,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
        leads: {
          owned: {
            total: ownedLeads?.length || 0,
            byDisposition: {
              not_home: ownedLeads?.filter(l => l.canvass_disposition === 'not_home').length || 0,
              bad_roof: ownedLeads?.filter(l => l.canvass_disposition === 'bad_roof').length || 0,
              renter: ownedLeads?.filter(l => l.canvass_disposition === 'renter').length || 0,
              go_back: ownedLeads?.filter(l => l.canvass_disposition === 'go_back').length || 0,
              hot_lead: ownedLeads?.filter(l => l.canvass_disposition === 'hot_lead').length || 0,
              not_interested: ownedLeads?.filter(l => l.canvass_disposition === 'not_interested').length || 0,
              null_disposition: ownedLeads?.filter(l => !l.canvass_disposition).length || 0,
            },
            bySource: {
              door_to_door: ownedLeads?.filter(l => l.source === 'door_to_door').length || 0,
              other: ownedLeads?.filter(l => l.source !== 'door_to_door').length || 0,
            },
            contacts: ownedLeads?.filter(l => contactDispositions.includes(l.canvass_disposition || '')).length || 0,
            recentSamples: ownedLeads?.slice(0, 5).map(l => ({
              id: l.id,
              created_at: l.created_at,
              disposition: l.canvass_disposition,
              source: l.source,
              status: l.status,
            })),
          },
          asCloser: {
            total: closerLeads?.length || 0,
          },
        },
        opportunities: {
          asSetter: {
            total: setterOpps?.length || 0,
          },
          asOwner: {
            total: ownerOpps?.length || 0,
            sales: ownerOpps?.filter(o => o.inspection_outcome === 'sale').length || 0,
            inspectionsRun: ownerOpps?.filter(o => o.inspection_outcome).length || 0,
          },
        },
        calculatedStats: {
          doorsKnocked: ownedLeads?.length || 0,
          contacts: ownedLeads?.filter(l => contactDispositions.includes(l.canvass_disposition || '')).length || 0,
          inspectionsSet: setterOpps?.length || 0,
          sales: ownerOpps?.filter(o => o.inspection_outcome === 'sale').length || 0,
        },
      })
    }

    return NextResponse.json({ 
      results,
      query: {
        userName,
        timeframe,
        orgId: profile.org_id,
      }
    })
  } catch (error) {
    console.error('Debug team stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch debug stats' }, { status: 500 })
  }
}
