import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Webhook handler for external integration callbacks
// Supports: EagleView, Roofr, Solo, Aurora, etc.

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    
    // Get provider from query params or headers
    const provider = request.nextUrl.searchParams.get('provider')
    const webhookSecret = request.headers.get('x-webhook-secret')
    
    if (!provider) {
      return NextResponse.json({ error: 'Provider not specified' }, { status: 400 })
    }

    const body = await request.json()

    // Verify webhook secret if configured
    const { data: config } = await supabase
      .from('integration_configs')
      .select('*')
      .eq('provider', provider)
      .eq('is_enabled', true)
      .single()

    if (!config) {
      return NextResponse.json({ error: 'Integration not configured' }, { status: 404 })
    }

    if (config.webhook_secret && config.webhook_secret !== webhookSecret) {
      return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 })
    }

    // Process based on provider
    let result
    switch (provider) {
      case 'eagleview':
        result = await processEagleViewWebhook(supabase, config, body)
        break
      case 'roofr':
        result = await processRoofrWebhook(supabase, config, body)
        break
      case 'solo':
        result = await processSoloWebhook(supabase, config, body)
        break
      case 'aurora':
        result = await processAuroraWebhook(supabase, config, body)
        break
      default:
        result = await processGenericWebhook(supabase, config, body)
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function processEagleViewWebhook(supabase: any, config: any, body: any) {
  // EagleView webhook structure
  const {
    orderId,
    status,
    reportUrl,
    measurements,
    address,
  } = body

  // Find the measurement request
  const { data: request } = await supabase
    .from('measurement_requests')
    .select('*')
    .eq('external_order_id', orderId)
    .single()

  if (!request) {
    return { message: 'Order not found' }
  }

  if (status === 'completed' && measurements) {
    // Create roof measurement from EagleView data
    const { data: measurement } = await supabase
      .from('roof_measurements')
      .insert({
        org_id: request.org_id,
        opportunity_id: request.opportunity_id,
        created_by: request.requested_by,
        address_text: address || request.address_text,
        lat: request.lat,
        lng: request.lng,
        source: 'eagleview',
        external_report_id: orderId,
        external_report_url: reportUrl,
        status: 'completed',
        total_area_sqft: measurements.totalArea,
        total_squares: measurements.totalArea / 100,
        ridges_lf: measurements.ridges,
        hips_lf: measurements.hips,
        valleys_lf: measurements.valleys,
        eaves_lf: measurements.eaves,
        rakes_lf: measurements.rakes,
        predominant_pitch: measurements.predominantPitch,
        facet_count: measurements.facets?.length || 0,
        suggested_waste_percent: measurements.wastePercent || 10,
        raw_data: body,
      })
      .select()
      .single()

    // Insert facets
    if (measurement && measurements.facets) {
      const facetInserts = measurements.facets.map((f: any, idx: number) => ({
        measurement_id: measurement.id,
        facet_number: idx + 1,
        area_sqft: f.area,
        pitch: f.pitch,
        pitch_degrees: f.pitchDegrees,
        orientation: f.orientation,
        polygon_coords: f.coordinates,
      }))

      await supabase.from('roof_facets').insert(facetInserts)
    }

    // Update request status
    await supabase
      .from('measurement_requests')
      .update({
        status: 'completed',
        measurement_id: measurement?.id,
        callback_received_at: new Date().toISOString(),
      })
      .eq('id', request.id)

    return { message: 'Measurement created', measurementId: measurement?.id }
  }

  // Update request with error if failed
  if (status === 'failed') {
    await supabase
      .from('measurement_requests')
      .update({
        status: 'failed',
        error_message: body.error || 'Report generation failed',
        callback_received_at: new Date().toISOString(),
      })
      .eq('id', request.id)
  }

  return { message: 'Status updated' }
}

async function processRoofrWebhook(supabase: any, config: any, body: any) {
  // Roofr webhook structure
  const { report_id, status, data } = body

  const { data: request } = await supabase
    .from('measurement_requests')
    .select('*')
    .eq('external_order_id', report_id)
    .single()

  if (!request) {
    return { message: 'Order not found' }
  }

  if (status === 'complete' && data) {
    const { data: measurement } = await supabase
      .from('roof_measurements')
      .insert({
        org_id: request.org_id,
        opportunity_id: request.opportunity_id,
        created_by: request.requested_by,
        address_text: data.address || request.address_text,
        lat: request.lat,
        lng: request.lng,
        source: 'roofr',
        external_report_id: report_id,
        external_report_url: data.report_url,
        status: 'completed',
        total_area_sqft: data.total_sqft,
        total_squares: data.total_sqft / 100,
        ridges_lf: data.ridge_length,
        hips_lf: data.hip_length,
        valleys_lf: data.valley_length,
        eaves_lf: data.eave_length,
        rakes_lf: data.rake_length,
        predominant_pitch: data.primary_pitch,
        facet_count: data.planes?.length || 0,
        suggested_waste_percent: data.waste_factor || 10,
        raw_data: body,
      })
      .select()
      .single()

    await supabase
      .from('measurement_requests')
      .update({
        status: 'completed',
        measurement_id: measurement?.id,
        callback_received_at: new Date().toISOString(),
      })
      .eq('id', request.id)

    return { message: 'Measurement created', measurementId: measurement?.id }
  }

  return { message: 'Status updated' }
}

async function processSoloWebhook(supabase: any, config: any, body: any) {
  // Solo (solar) webhook - typically includes design data
  const { project_id, event_type, data } = body

  if (event_type === 'design.completed') {
    // Store solar design data
    // This would typically include panel layout, production estimates, etc.
    return { message: 'Solar design received' }
  }

  return { message: 'Event processed' }
}

async function processAuroraWebhook(supabase: any, config: any, body: any) {
  // Aurora Solar webhook
  const { project_id, event, payload } = body

  if (event === 'project.design.completed') {
    // Store Aurora design data
    return { message: 'Aurora design received' }
  }

  return { message: 'Event processed' }
}

async function processGenericWebhook(supabase: any, config: any, body: any) {
  // Generic handler for other providers
  console.log('Generic webhook received:', body)
  return { message: 'Webhook received' }
}

// GET endpoint to check webhook status
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    status: 'active',
    supported_providers: ['eagleview', 'roofr', 'solo', 'aurora', 'gaf_quickmeasure', 'hover', 'nearmap', 'google_solar'],
  })
}
