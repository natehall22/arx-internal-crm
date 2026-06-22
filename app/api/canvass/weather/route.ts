import { requireAuthApi } from '@/lib/auth'
import { getRecentStormReportsInBbox } from '@/lib/roofradar-open-data'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const NWS_ALERTS_URL =
  'https://api.weather.gov/alerts/active?status=actual&message_type=alert'
const NWS_USER_AGENT = 'ARX-CRM (nathan@arxroofing.com)'
const CACHE_MS = 1000 * 60 * 30

type Bbox = { n: number; s: number; e: number; w: number }

type GeoJsonFeature = {
  type: 'Feature'
  geometry: GeoJSON.Geometry | null
  properties: Record<string, unknown>
}

type WeatherResponse = {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
  refreshedAt: string
}

const responseCache = new Map<string, { expiresAt: number; body: WeatherResponse }>()

function emptyResponse(): WeatherResponse {
  return {
    type: 'FeatureCollection',
    features: [],
    refreshedAt: new Date().toISOString(),
  }
}

function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const n = Number(searchParams.get('n'))
  const s = Number(searchParams.get('s'))
  const e = Number(searchParams.get('e'))
  const w = Number(searchParams.get('w'))
  if (![n, s, e, w].every(Number.isFinite)) return null
  if (n <= s || e <= w) return null
  return { n, s, e, w }
}

function parseLayer(value: string | null): 'hail' | 'wind' | null {
  if (value === 'hail' || value === 'wind') return value
  return null
}

function bboxesOverlap(a: Bbox, b: Bbox) {
  return a.n >= b.s && a.s <= b.n && a.e >= b.w && a.w <= b.e
}

function collectCoordinates(geometry: GeoJSON.Geometry, coords: Array<[number, number]>) {
  switch (geometry.type) {
    case 'Point':
      coords.push([geometry.coordinates[0], geometry.coordinates[1]])
      break
    case 'MultiPoint':
      geometry.coordinates.forEach((c) => coords.push([c[0], c[1]]))
      break
    case 'LineString':
      geometry.coordinates.forEach((c) => coords.push([c[0], c[1]]))
      break
    case 'MultiLineString':
      geometry.coordinates.forEach((line) => line.forEach((c) => coords.push([c[0], c[1]])))
      break
    case 'Polygon':
      geometry.coordinates.forEach((ring) => ring.forEach((c) => coords.push([c[0], c[1]])))
      break
    case 'MultiPolygon':
      geometry.coordinates.forEach((poly) =>
        poly.forEach((ring) => ring.forEach((c) => coords.push([c[0], c[1]]))),
      )
      break
    default:
      break
  }
}

function geometryBounds(geometry: GeoJSON.Geometry | null): Bbox | null {
  if (!geometry) return null
  const coords: Array<[number, number]> = []
  collectCoordinates(geometry, coords)
  if (!coords.length) return null
  let n = -Infinity
  let s = Infinity
  let e = -Infinity
  let w = Infinity
  for (const [lng, lat] of coords) {
    if (lat > n) n = lat
    if (lat < s) s = lat
    if (lng > e) e = lng
    if (lng < w) w = lng
  }
  return { n, s, e, w }
}

function isStormWarningEvent(event: unknown) {
  const text = String(event || '')
  return text.includes('Severe Thunderstorm Warning') || text.includes('Tornado Warning')
}

async function fetchNwsWarningFeatures(bbox: Bbox, layer: 'hail' | 'wind'): Promise<GeoJsonFeature[]> {
  try {
    const response = await fetch(NWS_ALERTS_URL, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': NWS_USER_AGENT,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return []

    const payload = (await response.json().catch(() => null)) as {
      features?: Array<{
        geometry?: GeoJSON.Geometry | null
        properties?: Record<string, unknown>
      }>
    } | null

    const features = payload?.features || []
    const out: GeoJsonFeature[] = []

    for (const feature of features) {
      const event = feature.properties?.event
      if (!isStormWarningEvent(event)) continue
      const bounds = geometryBounds(feature.geometry ?? null)
      if (!bounds || !bboxesOverlap(bbox, bounds)) continue
      out.push({
        type: 'Feature',
        geometry: feature.geometry ?? null,
        properties: {
          kind: 'warning',
          layer,
          event: String(event || 'Storm Warning'),
          source: 'nws',
          expires: feature.properties?.expires ? String(feature.properties.expires) : undefined,
        },
      })
    }

    return out
  } catch {
    // NWS slow/unreachable — return no warnings rather than failing the whole request
    return []
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const bbox = parseBbox(searchParams)
  const layer = parseLayer(searchParams.get('layer'))
  // Cap at 730 days (2 yrs) — insurance claim scope doesn't run past 2 years.
  const windowDays = Math.min(730, Math.max(1, Number(searchParams.get('windowDays') || 730)))

  if (!bbox || !layer) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const cacheKey = `${bbox.n}|${bbox.s}|${bbox.e}|${bbox.w}|${layer}|${windowDays}`
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.body)
  }

  try {
    const reports = await getRecentStormReportsInBbox(bbox, layer, windowDays)
    const reportFeatures: GeoJsonFeature[] = reports.map((report) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [report.lng, report.lat],
      },
      properties: {
        kind: 'report',
        layer,
        magnitude: report.magnitude,
        damage: report.damage,
        date: report.date.toISOString(),
        source: 'iem',
      },
    }))

    const warningFeatures = await fetchNwsWarningFeatures(bbox, layer)
    const body: WeatherResponse = {
      type: 'FeatureCollection',
      features: [...reportFeatures, ...warningFeatures],
      refreshedAt: new Date().toISOString(),
    }

    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, body })
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(emptyResponse())
  }
}
