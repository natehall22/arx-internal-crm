import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// Request a roof measurement from an external provider

export async function POST(request: NextRequest) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // RLS-bound client: this route's reads/writes rely on the org policies on the
    // tables below, so it must stay the caller's client rather than a service client.
    const supabase = createClient()

    const body = await request.json()
    const { provider, address, lat, lng, opportunity_id, options } = body

    if (!provider || !address) {
      return NextResponse.json({ error: 'Provider and address are required' }, { status: 400 })
    }

    // Check if provider is configured
    const { data: config } = await supabase
      .from('integration_configs')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('provider', provider)
      .eq('is_enabled', true)
      .single()

    if (!config) {
      return NextResponse.json({ 
        error: 'Integration not configured',
        message: `${provider} is not connected. Please configure it in Admin > Integrations.`
      }, { status: 400 })
    }

    // Create measurement request record
    const { data: measurementRequest, error: insertError } = await supabase
      .from('measurement_requests')
      .insert({
        org_id: profile.org_id,
        provider,
        address_text: address,
        lat,
        lng,
        opportunity_id,
        requested_by: profile.id,
        status: 'pending',
      })
      .select()
      .single()

    if (insertError) {
      throw insertError
    }

    // Call the external provider API
    let externalOrderId: string | null = null
    let apiError: string | null = null

    try {
      switch (provider) {
        case 'eagleview':
          externalOrderId = await requestEagleViewReport(config, address, lat, lng, options)
          break
        case 'roofr':
          externalOrderId = await requestRoofrReport(config, address, lat, lng, options)
          break
        case 'gaf_quickmeasure':
          externalOrderId = await requestGAFReport(config, address, lat, lng, options)
          break
        case 'google_solar':
          // Google Solar API can return data immediately
          const solarData = await requestGoogleSolarData(config, lat, lng)
          if (solarData) {
            // Create measurement directly
            const { data: measurement } = await supabase
              .from('roof_measurements')
              .insert({
                org_id: profile.org_id,
                opportunity_id,
                created_by: profile.id,
                address_text: address,
                lat,
                lng,
                source: 'google_solar',
                status: 'completed',
                total_area_sqft: solarData.roofArea,
                total_squares: solarData.roofArea / 100,
                raw_data: solarData,
              })
              .select()
              .single()

            await supabase
              .from('measurement_requests')
              .update({
                status: 'completed',
                measurement_id: measurement?.id,
              })
              .eq('id', measurementRequest.id)

            return NextResponse.json({
              success: true,
              status: 'completed',
              measurementId: measurement?.id,
            })
          }
          break
        default:
          apiError = 'Provider not supported for automatic requests'
      }
    } catch (err: any) {
      apiError = err.message || 'Failed to request report from provider'
    }

    // Update request with external order ID or error
    if (externalOrderId) {
      await supabase
        .from('measurement_requests')
        .update({
          external_order_id: externalOrderId,
          status: 'processing',
        })
        .eq('id', measurementRequest.id)

      return NextResponse.json({
        success: true,
        status: 'processing',
        requestId: measurementRequest.id,
        externalOrderId,
        message: 'Report requested. You will be notified when it\'s ready.',
      })
    } else {
      await supabase
        .from('measurement_requests')
        .update({
          status: 'failed',
          error_message: apiError,
        })
        .eq('id', measurementRequest.id)

      return NextResponse.json({
        success: false,
        error: apiError,
      }, { status: 400 })
    }
  } catch (error: any) {
    console.error('Request measurement error:', error)
    return NextResponse.json({ error: error.message || 'Request failed' }, { status: 500 })
  }
}

// Provider-specific API calls

async function requestEagleViewReport(config: any, address: string, lat: number, lng: number, options: any) {
  // EagleView API integration
  // Documentation: https://www.eagleview.com/api
  
  const response = await fetch('https://api.eagleview.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: {
        streetAddress: address,
        latitude: lat,
        longitude: lng,
      },
      productType: options?.productType || 'PremiumReport',
      deliveryMethod: 'webhook',
      webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/webhook?provider=eagleview`,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'EagleView API error')
  }

  const data = await response.json()
  return data.orderId
}

async function requestRoofrReport(config: any, address: string, lat: number, lng: number, options: any) {
  // Roofr API integration
  // Documentation: https://www.roofr.com/api
  
  const response = await fetch('https://api.roofr.com/v1/reports', {
    method: 'POST',
    headers: {
      'X-API-Key': config.api_key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address,
      coordinates: { lat, lng },
      report_type: options?.reportType || 'standard',
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/webhook?provider=roofr`,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Roofr API error')
  }

  const data = await response.json()
  return data.report_id
}

async function requestGAFReport(config: any, address: string, lat: number, lng: number, options: any) {
  // GAF QuickMeasure API
  // Note: Actual API may differ
  
  const response = await fetch('https://api.gaf.com/quickmeasure/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address,
      lat,
      lng,
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/webhook?provider=gaf_quickmeasure`,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'GAF API error')
  }

  const data = await response.json()
  return data.order_id
}

async function requestGoogleSolarData(config: any, lat: number, lng: number) {
  // Google Solar API
  // Documentation: https://developers.google.com/maps/documentation/solar
  
  const apiKey = config.api_key || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  
  const response = await fetch(
    `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${apiKey}`
  )

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  
  return {
    roofArea: data.solarPotential?.wholeRoofStats?.areaMeters2 * 10.7639 || 0, // Convert to sqft
    maxPanelCount: data.solarPotential?.maxArrayPanelsCount || 0,
    maxSunshineHours: data.solarPotential?.maxSunshineHoursPerYear || 0,
    carbonOffset: data.solarPotential?.carbonOffsetFactorKgPerMwh || 0,
    roofSegments: data.solarPotential?.roofSegmentStats || [],
    raw: data,
  }
}

// GET endpoint to check request status
export async function GET(request: NextRequest) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // RLS-bound client: this route's reads/writes rely on the org policies on the
    // tables below, so it must stay the caller's client rather than a service client.
    const supabase = createClient()

    const requestId = request.nextUrl.searchParams.get('id')
    
    if (!requestId) {
      return NextResponse.json({ error: 'Request ID required' }, { status: 400 })
    }

    const { data: measurementRequest } = await supabase
      .from('measurement_requests')
      .select('*, roof_measurements(*)')
      .eq('id', requestId)
      .single()

    if (!measurementRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    return NextResponse.json({
      status: measurementRequest.status,
      measurement: measurementRequest.roof_measurements,
      error: measurementRequest.error_message,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
