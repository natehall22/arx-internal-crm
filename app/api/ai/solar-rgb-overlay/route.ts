import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { fetchSolarRgbOverlayPayload } from '@/lib/solar-rgb-overlay'

export const dynamic = 'force-dynamic'

/**
 * Returns Google Solar RGB GeoTIFF as PNG + WGS84 bounds for a display-only GroundOverlay.
 * Does not affect detect-roof geometry — use for closer visual reference when editing vertices.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuthApi()
    const { searchParams } = new URL(request.url)
    const lat = Number(searchParams.get('lat'))
    const lng = Number(searchParams.get('lng'))

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: 'lat, lng required' }, { status: 400 })
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Google Maps API key missing' }, { status: 500 })
    }

    const payload = await fetchSolarRgbOverlayPayload(lat, lng, apiKey)
    if (!payload) {
      return NextResponse.json(
        { error: 'HD satellite overlay unavailable for this location' },
        { status: 404 }
      )
    }

    return NextResponse.json(payload)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Solar RGB overlay failed'
    const status =
      message === 'Unauthorized' || message === 'Account disabled' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
