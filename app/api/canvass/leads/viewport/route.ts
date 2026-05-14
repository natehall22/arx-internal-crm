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
import {
  fetchExteriorRingsForUser,
  filterLeadsByTerritoryRings,
  leadLngLatInRings,
} from '@/lib/canvass-territories'
import { ensureLeadHasMapPin } from '@/lib/lead-map-pin'

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
const SCHEDULED_PIN_REPAIR_SCAN_LIMIT = 250
const SCHEDULED_PIN_REPAIR_LIMIT = 25

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

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function repairScheduledInspectionPinsForOrg(adminClient: any, orgId: string) {
  try {
    const { data: appointments, error } = await adminClient
      .from('scheduled_appointments')
      .select('id, org_id, lead_id, address_text, scheduled_for')
      .eq('org_id', orgId)
      .in('status', ['scheduled', 'confirmed'])
      .or('appointment_type.is.null,appointment_type.eq.inspection')
      .not('lead_id', 'is', null)
      .order('scheduled_for', { ascending: false })
      .limit(SCHEDULED_PIN_REPAIR_SCAN_LIMIT)

    if (error) {
      console.error('Scheduled inspection pin repair query error:', error)
      return
    }

    const appointmentsByLeadId = new Map<string, any>()
    for (const appointment of appointments || []) {
      if (appointment.lead_id && !appointmentsByLeadId.has(appointment.lead_id)) {
        appointmentsByLeadId.set(appointment.lead_id, appointment)
      }
    }

    const leadIds = Array.from(appointmentsByLeadId.keys())
    if (leadIds.length === 0) return

    const { data: leads, error: leadsError } = await adminClient
      .from('leads')
      .select('id, org_id, address_text, lat, lng, status, inspection_scheduled_for')
      .eq('org_id', orgId)
      .in('id', leadIds)
      .or('status.is.null,status.neq.inspection,inspection_scheduled_for.is.null,lat.is.null,lng.is.null')
      .limit(SCHEDULED_PIN_REPAIR_LIMIT)

    if (leadsError) {
      console.error('Scheduled inspection lead repair query error:', leadsError)
      return
    }

    for (const lead of leads || []) {
      const appointment = appointmentsByLeadId.get(lead.id)
      if (!lead?.id) continue

      const needsScheduledState =
        lead.status !== 'inspection' ||
        !lead.inspection_scheduled_for
      const needsCoordinates = lead.lat == null || lead.lng == null

      if (needsScheduledState) {
        const patch: Record<string, unknown> = { status: 'inspection' }
        if (!lead.inspection_scheduled_for && appointment.scheduled_for) {
          patch.inspection_scheduled_for = appointment.scheduled_for
        }

        const { error: leadPatchError } = await adminClient
          .from('leads')
          .update(patch)
          .eq('id', lead.id)
          .eq('org_id', orgId)

        if (leadPatchError) {
          console.error('Scheduled inspection lead state repair error:', leadPatchError)
        }
      }

      if (needsCoordinates) {
        await ensureLeadHasMapPin(adminClient, {
          id: lead.id,
          org_id: orgId,
          address_text: lead.address_text || appointment.address_text,
          lat: lead.lat,
          lng: lead.lng,
        })
      }
    }
  } catch (error) {
    console.error('Scheduled inspection pin repair failed:', error)
  }
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

    await repairScheduledInspectionPinsForOrg(adminClient, profile.org_id)

    // Determine visibility filter (same logic as /api/canvass/data)
    let visibleUserIds: string[] = []
    const visibility = profile.canvass_pin_visibility || 'org'
    const isManager = ['owner', 'admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)
    const territoryMode = !isManager && visibility === 'territory'

    if (isManager || visibility === 'org') {
      visibleUserIds = []
    } else if (territoryMode) {
      // Geographic filter: load org pins in bbox, then keep points inside assigned polygons
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

    const queryLimit =
      territoryMode ? Math.min(limit * 25, 10000) : limit

    // Parse excluded IDs (already loaded pins)
    const excludeIds = excludeIdsParam ? excludeIdsParam.split(',').filter(Boolean) : []

    // MINIMAL SELECT - only what's needed for pin rendering
    // Full details fetched via /api/canvass/lead/[id] on click
    let query = adminClient
      .from('leads')
      .select('id, lat, lng, canvass_disposition, status, owner_user_id, pin_attributed_user_id, created_at, installation_agreement_signed_at')
      .eq('org_id', profile.org_id)
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .gte('lat', minLat)
      .lte('lat', maxLat)
      .gte('lng', minLng)
      .lte('lng', maxLng)
      .limit(queryLimit)

    // Apply visibility filter (include pin_attributed_user_id so deleted users' pins stay visible)
    if (visibleUserIds.length > 0) {
      const idList = visibleUserIds.join(',')
      query = query.or(`owner_user_id.in.(${idList}),pin_attributed_user_id.in.(${idList})`)
    }

    // Apply disposition filter if provided
    // "Scheduled" in the app maps pins with status=inspection (and/or disposition inspection_scheduled), not canvass_disposition='scheduled'
    if (disposition) {
      if (disposition === 'scheduled') {
        query = query.or('status.eq.inspection,canvass_disposition.eq.inspection_scheduled')
      } else {
        query = query.eq('canvass_disposition', disposition)
      }
    }

    // Exclude already-loaded IDs (for incremental loading)
    if (excludeIds.length > 0 && excludeIds.length < 1000) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`)
    }

    // Order by recency for consistent pagination
    query = query.order('created_at', { ascending: false })

    const { data: leadsRaw, error: leadsError } = await query

    if (leadsError) {
      console.error('Viewport leads query error:', leadsError)
      return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })
    }

    let leads = leadsRaw || []
    if (territoryMode) {
      const rings = await fetchExteriorRingsForUser(adminClient, profile.org_id, user.id)
      leads = filterLeadsByTerritoryRings(leads, rings, limit)
    }

    // Return minimal pin data
    const pins = leads.map(lead => {
      const row = lead as {
        id: string
        lat: unknown
        lng: unknown
        canvass_disposition: string | null
        status: string
        owner_user_id: string | null
        pin_attributed_user_id?: string | null
        created_at: string
        installation_agreement_signed_at?: string | null
      }
      const base = {
        id: row.id,
        lat: parseFloat(String(row.lat)),
        lng: parseFloat(String(row.lng)),
        d: row.canvass_disposition,
        s: row.status,
        o: row.owner_user_id ?? row.pin_attributed_user_id,
        t: row.created_at,
      }
      // `ia` = installation agreement signed (canvass green $ marker)
      if (row.installation_agreement_signed_at) {
        return { ...base, ia: true as const }
      }
      return base
    })

    const rawCount = (leadsRaw || []).length
    const truncated = pins.length >= limit || rawCount >= queryLimit

    return NextResponse.json({
      pins,
      count: pins.length,
      limit,
      zoom,
      hasMore: truncated,
      truncated, // Explicit flag for client to show "zoom in for more" message
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

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, canvass_pin_visibility')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const isManager = ['owner', 'admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)
    const territoryMode = !isManager && (profile.canvass_pin_visibility || 'org') === 'territory'

    const { data: leads, error } = await adminClient
      .from('leads')
      .select('*, owner:users!leads_owner_user_id_fkey(id, full_name)')
      .eq('org_id', profile.org_id)
      .in('id', ids)

    if (error) {
      console.error('Lead details fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })
    }

    let out = leads || []
    if (territoryMode && out.length > 0) {
      const rings = await fetchExteriorRingsForUser(adminClient, profile.org_id, user.id)
      if (rings.length === 0) {
        out = []
      } else {
        out = out.filter((row) => {
          const lng = parseFloat(String(row.lng))
          const lat = parseFloat(String(row.lat))
          if (Number.isNaN(lng) || Number.isNaN(lat)) return false
          return leadLngLatInRings(lng, lat, rings)
        })
      }
    }

    return NextResponse.json({ leads: out })

  } catch (err) {
    console.error('Lead details error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
