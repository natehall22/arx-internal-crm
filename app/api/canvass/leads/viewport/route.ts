/**
 * VIEWPORT LEADS API - Spotio/Terros style map loading at scale
 * 
 * Designed for 100k+ pins with hundreds of users.
 * Returns MINIMAL data for pin rendering - full details fetched on click.
 * 
 * Query params:
 *   - minLat, maxLat, minLng, maxLng: Bounding box (required)
 *   - zoom: Current zoom level (required for density control)
 *   - disposition: Filter by disposition (optional)
 *   - excludeIds: Comma-separated IDs already loaded (optional, for incremental loading)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Limits based on zoom level - prevents loading too many pins at low zoom
const ZOOM_LIMITS: Record<number, number> = {
  20: 5000,  // Street level - show everything
  19: 5000,
  18: 3000,  // Building level
  17: 2000,
  16: 1500,  // Block level
  15: 1000,
  14: 500,   // Neighborhood level
  13: 300,
  12: 200,   // City level - heavily limited
  11: 100,
  10: 50,    // Metro level - just show density
}

// Minimum zoom to load any pins (prevents loading entire state/country)
const MIN_ZOOM_FOR_PINS = 10

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

    const { searchParams } = new URL(request.url)
    const minLat = parseFloat(searchParams.get('minLat') || '')
    const maxLat = parseFloat(searchParams.get('maxLat') || '')
    const minLng = parseFloat(searchParams.get('minLng') || '')
    const maxLng = parseFloat(searchParams.get('maxLng') || '')
    const zoom = parseInt(searchParams.get('zoom') || '15', 10)
    const disposition = searchParams.get('disposition') || null
    const excludeIdsParam = searchParams.get('excludeIds') || ''

    // Validate bounds
    if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLng) || isNaN(maxLng)) {
      return NextResponse.json({ 
        error: 'Invalid bounds. Required: minLat, maxLat, minLng, maxLng' 
      }, { status: 400 })
    }

    // Check minimum zoom level
    if (zoom < MIN_ZOOM_FOR_PINS) {
      return NextResponse.json({ 
        leads: [],
        message: 'Zoom in to see pins',
        minZoomRequired: MIN_ZOOM_FOR_PINS,
      })
    }

    // Get limit based on zoom level
    const limit = ZOOM_LIMITS[Math.min(zoom, 20)] || ZOOM_LIMITS[20]

    const adminClient = getAdminClient()

    // Get user profile for org_id and visibility settings
    const { data: profile, error: profileError } = await adminClient
      .from('users')
      .select('role, org_id, team_id, region_id, canvass_pin_visibility')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Determine visibility filter (same logic as /api/canvass/data)
    let visibleUserIds: string[] = []
    const visibility = profile.canvass_pin_visibility || 'org'
    const isManager = ['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)
    
    if (isManager || visibility === 'org') {
      visibleUserIds = []
    } else if (visibility === 'own') {
      visibleUserIds = [user.id]
    } else if (visibility === 'team') {
      if (profile.team_id) {
        const { data: teamUsers } = await adminClient
          .from('users')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('team_id', profile.team_id)
        visibleUserIds = Array.from(new Set([user.id, ...(teamUsers?.map(u => u.id) || [])]))
      } else {
        visibleUserIds = [user.id]
      }
    } else if (visibility === 'region') {
      if (profile.region_id) {
        const { data: regionUsers } = await adminClient
          .from('users')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('region_id', profile.region_id)
        visibleUserIds = Array.from(new Set([user.id, ...(regionUsers?.map(u => u.id) || [])]))
      } else {
        visibleUserIds = [user.id]
      }
    }

    // Parse excluded IDs (already loaded pins)
    const excludeIds = excludeIdsParam ? excludeIdsParam.split(',').filter(Boolean) : []

    // MINIMAL SELECT - only what's needed for pin rendering
    // Full details fetched via /api/canvass/lead/[id] on click
    let query = adminClient
      .from('leads')
      .select('id, lat, lng, canvass_disposition, status, owner_user_id, created_at')
      .eq('org_id', profile.org_id)
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .gte('lat', minLat)
      .lte('lat', maxLat)
      .gte('lng', minLng)
      .lte('lng', maxLng)
      .limit(limit)

    // Apply visibility filter
    if (visibleUserIds.length > 0) {
      query = query.in('owner_user_id', visibleUserIds)
    }

    // Apply disposition filter if provided
    if (disposition) {
      query = query.eq('canvass_disposition', disposition)
    }

    // Exclude already-loaded IDs (for incremental loading)
    if (excludeIds.length > 0 && excludeIds.length < 1000) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`)
    }

    // Order by recency for consistent pagination
    query = query.order('created_at', { ascending: false })

    const { data: leads, error: leadsError } = await query

    if (leadsError) {
      console.error('Viewport leads query error:', leadsError)
      return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })
    }

    // Return minimal pin data
    const pins = (leads || []).map(lead => ({
      id: lead.id,
      lat: parseFloat(lead.lat),
      lng: parseFloat(lead.lng),
      d: lead.canvass_disposition, // Short key for bandwidth
      s: lead.status,              // Short key for bandwidth
      o: lead.owner_user_id,       // Short key for bandwidth
      t: lead.created_at,          // Timestamp for sorting
    }))

    return NextResponse.json({
      pins,
      count: pins.length,
      limit,
      zoom,
      hasMore: pins.length >= limit,
    })

  } catch (err) {
    console.error('Viewport leads error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

/**
 * POST endpoint for fetching full lead details (on pin click)
 * Batch-capable for efficiency
 */
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

    const body = await request.json()
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }

    // Limit batch size
    if (ids.length > 50) {
      return NextResponse.json({ error: 'Max 50 IDs per request' }, { status: 400 })
    }

    const adminClient = getAdminClient()

    // Get user's org
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Fetch full lead details
    const { data: leads, error } = await adminClient
      .from('leads')
      .select('*, owner:users!leads_owner_user_id_fkey(id, full_name)')
      .eq('org_id', profile.org_id)
      .in('id', ids)

    if (error) {
      console.error('Lead details fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })
    }

    return NextResponse.json({ leads: leads || [] })

  } catch (err) {
    console.error('Lead details error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
