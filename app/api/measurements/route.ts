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

// GET - Get measurements list or opportunity address
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
    const opportunityId = searchParams.get('opportunity_id')
    const listAll = searchParams.get('list') === 'true'

    // If opportunity_id provided, get the address for that opportunity
    if (opportunityId) {
      const { data: opportunity } = await adminClient
        .from('opportunities')
        .select('address_text, lat, lng')
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .single()

      return NextResponse.json({ opportunity })
    }

    // List all measurements
    if (listAll) {
      const { data: measurements } = await adminClient
        .from('roof_measurements')
        .select('*, opportunities(id, status)')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      return NextResponse.json({ measurements: measurements || [] })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('Measurements API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch measurements' 
    }, { status: 500 })
  }
}

// POST - Save a new measurement
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
    const { measurements, opportunityId } = body

    // Save main measurement
    const { data: measurement, error: measurementError } = await adminClient
      .from('roof_measurements')
      .insert({
        org_id: profile.org_id,
        opportunity_id: opportunityId || null,
        created_by: user.id,
        address_text: measurements.address,
        lat: measurements.lat,
        lng: measurements.lng,
        source: 'in_house',
        status: 'completed',
        total_area_sqft: measurements.total_area_sqft,
        total_squares: measurements.total_squares,
        ridges_lf: measurements.ridges_lf,
        hips_lf: measurements.hips_lf,
        valleys_lf: measurements.valleys_lf,
        eaves_lf: measurements.eaves_lf,
        rakes_lf: measurements.rakes_lf,
        predominant_pitch: measurements.predominant_pitch,
        facet_count: measurements.facets?.length || 0,
        suggested_waste_percent: measurements.suggested_waste,
        raw_data: measurements,
      })
      .select()
      .single()

    if (measurementError) {
      console.error('Measurement save error:', measurementError)
      return NextResponse.json({ error: `Failed to save measurement: ${measurementError.message}` }, { status: 400 })
    }

    // Save facets
    if (measurement && measurements.facets && measurements.facets.length > 0) {
      const facetInserts = measurements.facets.map((f: any, idx: number) => ({
        measurement_id: measurement.id,
        facet_number: idx + 1,
        area_sqft: f.area_sqft,
        pitch: f.pitch,
        pitch_degrees: f.pitch_degrees,
        orientation: f.orientation,
        polygon_coords: f.points,
      }))

      const { error: facetsError } = await adminClient
        .from('roof_facets')
        .insert(facetInserts)

      if (facetsError) {
        console.error('Facets save error:', facetsError)
        // Don't fail the whole request, measurement is already saved
      }
    }

    return NextResponse.json({ measurement })
  } catch (error) {
    console.error('Measurements API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to save measurement' 
    }, { status: 500 })
  }
}
