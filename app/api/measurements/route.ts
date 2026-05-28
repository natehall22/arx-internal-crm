import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { isConfirmedPitchSource } from '@/lib/roof-measure-solar-pitch'

export const dynamic = 'force-dynamic'

// GET - Get measurements list or opportunity address
export async function GET(request: NextRequest) {
  try {
    let authContext
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()
    const profile = authContext.profile

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
    let authContext
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()
    const profile = authContext.profile

    const body = await request.json()
    const { measurements, opportunityId } = body

    const facetRows = measurements?.facets
    if (Array.isArray(facetRows) && facetRows.length > 0) {
      const hasUnresolvedPitch = facetRows.some(
        (f: { pitch?: string }) =>
          !f?.pitch || String(f.pitch).trim() === '' || f.pitch === 'Unset'
      )
      if (hasUnresolvedPitch) {
        return NextResponse.json(
          { error: 'All roof sections must have a confirmed pitch before saving.' },
          { status: 400 }
        )
      }

      const hasUnconfirmedPitch = facetRows.some(
        (f: { pitch_source?: string }) => !isConfirmedPitchSource(f.pitch_source as 'manual' | 'unknown' | 'solar_auto' | undefined)
      )
      if (hasUnconfirmedPitch) {
        return NextResponse.json(
          { error: 'Every roof section must have a confirmed slope before saving (choose pitch or accept Solar suggestion).' },
          { status: 400 }
        )
      }

      const hasUnreviewedGeometry = facetRows.some((f: { geometry_reviewed?: boolean }) => f.geometry_reviewed !== true)
      if (hasUnreviewedGeometry) {
        return NextResponse.json(
          { error: 'Every roof outline must be reviewed before saving.' },
          { status: 400 }
        )
      }

      const hasUnsupportedGeometry = facetRows.some((f: { geometry_source?: string }) =>
        f.geometry_source === 'solar_bbox' || f.geometry_source === 'solar_mask_whole'
      )
      if (hasUnsupportedGeometry) {
        return NextResponse.json(
          { error: 'Solar box or whole-mask geometry is not quote-ready. Correct or redraw roof faces before saving.' },
          { status: 400 }
        )
      }
    }

    const quoteReady = measurements?.quote_ready === true

    // Save main measurement
    const { data: measurement, error: measurementError } = await adminClient
      .from('roof_measurements')
      .insert({
        org_id: profile.org_id,
        opportunity_id: opportunityId || null,
        created_by: authContext.authUser.id,
        address_text: measurements.address,
        lat: measurements.lat,
        lng: measurements.lng,
        source: 'in_house',
        status: quoteReady ? 'completed' : 'needs_review',
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
