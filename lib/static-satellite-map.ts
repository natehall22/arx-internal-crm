/**
 * Shared Static Maps (satellite) helpers for roof vision: same logical size + zoom as
 * `/api/ai/detect-roof` when aligned with the interactive map (`mapBounds` present).
 * Server-only fetch helpers live in `static-satellite-map.server.ts` (Sharp).
 */
import type { GeoBounds } from '@/lib/roof-measure-map-zoom'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Geographic bounds for a Static Maps snapshot (scale=2 bitmap, Web Mercator). */
export function staticMapImageBounds(
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
): GeoBounds {
  const scale = 256 * Math.pow(2, zoom)
  const sinLat = clamp(Math.sin((centerLat * Math.PI) / 180), -0.9999, 0.9999)
  const cx = ((centerLng + 180) / 360) * scale
  const cy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale

  const cornerLatLng = (px: number, py: number) => {
    const wx = cx + (px - imageWidth / 2)
    const wy = cy + (py - imageHeight / 2)
    const lng = (wx / scale) * 360 - 180
    const n = Math.PI - (2 * Math.PI * wy) / scale
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
    return { lat, lng }
  }

  const corners = [
    cornerLatLng(0, 0),
    cornerLatLng(imageWidth, 0),
    cornerLatLng(imageWidth, imageHeight),
    cornerLatLng(0, imageHeight),
  ]
  return {
    north: Math.max(...corners.map((c) => c.lat)),
    south: Math.min(...corners.map((c) => c.lat)),
    east: Math.max(...corners.map((c) => c.lng)),
    west: Math.min(...corners.map((c) => c.lng)),
  }
}

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
