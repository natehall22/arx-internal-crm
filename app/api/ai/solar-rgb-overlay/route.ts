import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchSolarRgbOverlayPayload } from '@/lib/solar-rgb-overlay'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Returns satellite PNG + WGS84 bounds for super-zoom fine-tune editor.
 * Prefers Google Solar RGB GeoTIFF; falls back to Static Maps so the editor always gets imagery.
 */
export async function GET(request: NextRequest) {
  try {
    const authContext = await requireAuthApi()
    const admin = createServiceClient()
    if (await resolveSalesDocAccessBarred(admin, authContext.authUser.id, authContext.profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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
    return NextResponse.json(payload)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Solar RGB overlay failed'
    const status =
      message === 'Unauthorized' || message === 'Account disabled' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
