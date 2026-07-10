import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'
import {
  clampVisionAlignStaticZoom,
  computeStaticLogicalSize,
  fetchStaticSatelliteMapBase64,
} from '@/lib/static-satellite-map'

export const dynamic = 'force-dynamic'

/**
 * Returns a base64 PNG (no data: prefix) for the same satellite frame vision uses when
 * the client has `mapBounds` — lets the browser request it first so timestamps/cache
 * match before POSTing `/api/ai/detect-roof` with `imageBase64`.
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
    const zoom = Number(searchParams.get('zoom'))
    const mapWidthPx = Number(searchParams.get('mapWidthPx') || '640')
    const mapHeightPx = Number(searchParams.get('mapHeightPx') || '640')

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
      return NextResponse.json({ error: 'lat, lng, zoom required' }, { status: 400 })
    }

    const effectiveZoom = clampVisionAlignStaticZoom(zoom)
    const { sizeW, sizeH } = computeStaticLogicalSize(
      Number.isFinite(mapWidthPx) ? mapWidthPx : 640,
      Number.isFinite(mapHeightPx) ? mapHeightPx : 640,
    )

    const base64 = await fetchStaticSatelliteMapBase64({
      lat,
      lng,
      zoom: effectiveZoom,
      sizeW,
      sizeH,
    })

    return NextResponse.json({
      base64,
      width: sizeW * 2,
      height: sizeH * 2,
      zoom: effectiveZoom,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Static map failed'
    const status =
      message === 'Unauthorized' || message === 'Account disabled' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
