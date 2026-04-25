/**
 * Shared Static Maps (satellite) helpers for roof vision: same logical size + zoom as
 * `/api/ai/detect-roof` when aligned with the interactive map (`mapBounds` present).
 */

export function computeStaticLogicalSize(mapWidthPx?: number, mapHeightPx?: number): { sizeW: number; sizeH: number } {
  const mw = typeof mapWidthPx === 'number' && mapWidthPx > 0 ? mapWidthPx : 640
  const mh = typeof mapHeightPx === 'number' && mapHeightPx > 0 ? mapHeightPx : 640
  const mMax = Math.max(mw, mh)
  let sizeW = Math.round((640 * mw) / mMax)
  let sizeH = Math.round((640 * mh) / mMax)
  sizeW = Math.max(100, Math.min(640, sizeW))
  sizeH = Math.max(100, Math.min(640, sizeH))
  return { sizeW, sizeH }
}

/** Matches `finalZoom` in detect-roof when `alignWithClientMap` (client sent bounds). */
export function clampVisionAlignStaticZoom(zoom: number): number {
  const z = Math.round(zoom)
  return Math.min(22, Math.max(15, z))
}

export async function fetchStaticSatelliteMapBase64(params: {
  lat: number
  lng: number
  zoom: number
  sizeW: number
  sizeH: number
}): Promise<string> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!mapsKey) {
    throw new Error('Google Maps API key missing on server')
  }

  const normalizedZoom = Math.round(params.zoom)
  const w = Math.max(100, Math.min(640, Math.round(params.sizeW)))
  const h = Math.max(100, Math.min(640, Math.round(params.sizeH)))

  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${params.lat},${params.lng}` +
    `&zoom=${normalizedZoom}&size=${w}x${h}&scale=2&maptype=satellite&key=${mapsKey}`

  const response = await fetch(url)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Static map fetch failed (${response.status}): ${text || 'unknown error'}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/')) {
    const text = await response.text().catch(() => '')
    throw new Error(`Static map returned text response: ${text || 'unknown error'}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return buffer.toString('base64')
}
