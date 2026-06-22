import type { WeatherBbox } from '@/lib/weather-footprint'
import type { WeatherGeoFeature } from '@/lib/weather-storage'

const NWS_ALERTS_URL =
  'https://api.weather.gov/alerts/active?status=actual&message_type=alert'
const NWS_USER_AGENT = 'ARX-CRM (nathan@arxroofing.com)'

function bboxesOverlap(a: WeatherBbox, b: WeatherBbox) {
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

function geometryBounds(geometry: GeoJSON.Geometry | null): WeatherBbox | null {
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

export async function fetchNwsWarningFeatures(
  bbox: WeatherBbox,
  layer: 'hail' | 'wind',
): Promise<{ features: WeatherGeoFeature[]; live: boolean }> {
  try {
    const response = await fetch(NWS_ALERTS_URL, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': NWS_USER_AGENT,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return { features: [], live: false }

    const payload = (await response.json().catch(() => null)) as {
      features?: Array<{
        geometry?: GeoJSON.Geometry | null
        properties?: Record<string, unknown>
      }>
    } | null

    const features = payload?.features || []
    const out: WeatherGeoFeature[] = []

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

    return { features: out, live: true }
  } catch {
    return { features: [], live: false }
  }
}

export { NWS_ALERTS_URL, NWS_USER_AGENT }
