import { contours as d3contours } from 'd3-contour'
import * as geotiff from 'geotiff'
import geokeysToProj4 from 'geotiff-geokeys-to-proj4'
import proj4 from 'proj4'

export type SolarMaskSegment = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  area_m2: number | null
  ground_area_m2: number | null
  center: { lat: number; lng: number } | null
}

export type SolarMaskFacetPayload = {
  id: string
  vertices: [number, number][]
  lat_lng_vertices: { lat: number; lng: number }[]
  confidence: number
  estimated_sq_ft: number | null
  solar_segment_index: number | null
  suggested_pitch_degrees: number | null
  suggested_azimuth_degrees: number | null
  suggested_ground_area_sqft: number | null
  facet_source: string
}

const MAX_MASK_PIXELS = 4_000_000
const MIN_RING_AREA_PX = 80
const MAX_FACETS = 6
const MAX_VERTICES_PER_RING = 48

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusMeters = 6371000
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function polygonAreaPx(ring: [number, number][]): number {
  if (ring.length < 3) return 0
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum / 2)
}

function ringCentroid(ring: [number, number][]): [number, number] {
  let cx = 0
  let cy = 0
  for (const [x, y] of ring) {
    cx += x
    cy += y
  }
  return [cx / ring.length, cy / ring.length]
}

function openRingPoints(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring
  const a = ring[0]
  const b = ring[ring.length - 1]
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1)
  return ring.slice()
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring
  const a = ring[0]
  const b = ring[ring.length - 1]
  if (a[0] === b[0] && a[1] === b[1]) return ring
  return [...ring, [a[0], a[1]]]
}

/** Evenly subsample a closed contour so the UI stays responsive. */
function decimateClosedRing(ring: [number, number][], maxVertices: number): [number, number][] {
  const open = openRingPoints(ring)
  if (open.length < 3) return ring
  if (open.length <= maxVertices) return closeRing(open)
  const out: [number, number][] = []
  const last = open.length - 1
  const denom = Math.max(1, maxVertices - 1)
  for (let i = 0; i < maxVertices; i++) {
    const idx = Math.round((i / denom) * last)
    out.push(open[idx])
  }
  return closeRing(out)
}

function planarPolygonAreaSqFt(vertices: { lat: number; lng: number }[]): number {
  if (vertices.length < 3) return 0
  const lat0 = vertices.reduce((s, p) => s + p.lat, 0) / vertices.length
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
  let sum = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % n]
    const x1 = a.lng * mPerDegLng
    const y1 = a.lat * mPerDegLat
    const x2 = b.lng * mPerDegLng
    const y2 = b.lat * mPerDegLat
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum / 2) * 10.7639
}

async function fetchDataLayersMaskUrl(lat: number, lng: number, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    'location.latitude': lat.toFixed(6),
    'location.longitude': lng.toFixed(6),
    radiusMeters: '100',
    view: 'IMAGERY_LAYERS',
    requiredQuality: 'BASE',
    exactQualityRequired: 'false',
    key: apiKey,
  })
  const url = `https://solar.googleapis.com/v1/dataLayers:get?${params}`
  const response = await fetch(url)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn('[solar-mask] dataLayers:get failed:', response.status, detail.slice(0, 200))
    return null
  }
  const data = (await response.json().catch(() => null)) as {
    maskUrl?: string
    mask_url?: string
    error?: { message?: string; code?: number }
  } | null
  if (data?.error?.message) {
    console.warn('[solar-mask] dataLayers error:', data.error.message)
    return null
  }
  const maskUrl =
    typeof data?.maskUrl === 'string'
      ? data.maskUrl
      : typeof data?.mask_url === 'string'
        ? data.mask_url
        : null
  return maskUrl && maskUrl.length > 0 ? maskUrl : null
}

function appendApiKeyToGeoTiffUrl(url: string, apiKey: string): string {
  if (url.includes('key=')) return url
  return url.includes('?') ? `${url}&key=${apiKey}` : `${url}?key=${apiKey}`
}

type MaskRasterAndProjector = {
  band0: geotiff.TypedArray
  width: number
  height: number
  pixelToLngLat: (col: number, row: number) => { lat: number; lng: number }
  /** Approximate pixel (column, row) for a WGS84 point; null if projection fails. */
  lngLatToColRow: (lat: number, lng: number) => { col: number; row: number } | null
}

async function loadMaskRasterAndProjector(
  maskUrl: string,
  apiKey: string
): Promise<MaskRasterAndProjector | null> {
  const fetchUrl = appendApiKeyToGeoTiffUrl(maskUrl, apiKey)
  const response = await fetch(fetchUrl)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn('[solar-mask] GeoTIFF fetch failed:', response.status, detail.slice(0, 200))
    return null
  }
  const arrayBuffer = await response.arrayBuffer()
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  if (width * height > MAX_MASK_PIXELS) {
    console.warn('[solar-mask] mask too large:', width, height)
    return null
  }

  const geoKeys = image.getGeoKeys()
  if (!geoKeys) {
    console.warn('[solar-mask] GeoTIFF missing geokeys')
    return null
  }

  let projObj: ReturnType<typeof geokeysToProj4.toProj4>
  try {
    projObj = geokeysToProj4.toProj4(geoKeys as Parameters<typeof geokeysToProj4.toProj4>[0])
  } catch (e) {
    console.warn('[solar-mask] geokeysToProj4 failed:', e)
    return null
  }
  if (projObj.errors?.CRSNotSupported != null) {
    console.warn('[solar-mask] CRS not supported for mask GeoTIFF')
    return null
  }

  const toWgs84 = proj4(projObj.proj4, '+proj=longlat +datum=WGS84 +no_defs')
  const conv = projObj.coordinatesConversionParameters
  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()

  const pixelToLngLat = (col: number, row: number) => {
    const gx = ox + col * rx
    const gy = oy + row * ry
    const c = geokeysToProj4.convertCoordinates(gx, gy, 0, conv)
    const projected = toWgs84.forward([c.x, c.y])
    const lng = projected[0]
    const lat = projected[1]
    return { lat, lng }
  }

  const lngLatToColRow = (lat: number, lng: number): { col: number; row: number } | null => {
    if (!Number.isFinite(conv.x) || !Number.isFinite(conv.y) || conv.x === 0 || conv.y === 0) return null
    try {
      const inv = toWgs84.inverse([lng, lat])
      const gx = inv[0] / conv.x
      const gy = inv[1] / conv.y
      const col = (gx - ox) / rx
      const row = (gy - oy) / ry
      if (!Number.isFinite(col) || !Number.isFinite(row)) return null
      return { col, row }
    } catch {
      return null
    }
  }

  const rasters = await image.readRasters()
  const band0 = rasters[0]
  if (!band0 || rasters.width !== width || rasters.height !== height) {
    console.warn('[solar-mask] failed to read mask band')
    return null
  }

  return { band0, width, height, pixelToLngLat, lngLatToColRow }
}

function pointInPolygonColRow(px: number, py: number, ring: [number, number][]): boolean {
  if (ring.length < 3) return false
  let inside = false
  const n = ring.length
  const m = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? n - 1 : n
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const denom = yj - yi
    if (Math.abs(denom) < 1e-14) continue
    if ((yi > py) !== (yj > py)) {
      const xInt = ((xj - xi) * (py - yi)) / denom + xi
      if (px < xInt) inside = !inside
    }
  }
  return inside
}

function nearestSegment(
  pt: { lat: number; lng: number },
  segments: SolarMaskSegment[]
): { segment: SolarMaskSegment; dist: number } | null {
  let best: { segment: SolarMaskSegment; dist: number } | null = null
  for (const seg of segments) {
    const c = seg.center
    if (!c) continue
    const d = distanceMeters(pt, c)
    if (!best || d < best.dist) best = { segment: seg, dist: d }
  }
  return best
}

/** Exported for unit tests — converts a roof-mask raster band to pixel-space rings (column, row). */
export function contourRingsFromMask(
  band: geotiff.TypedArray,
  width: number,
  height: number
): [number, number][][] {
  const values = new Float64Array(width * height)
  for (let i = 0; i < values.length; i++) {
    const v = band[i]
    values[i] = v !== 0 && Number(v) > 0 ? 1 : 0
  }

  if (width < 2 || height < 2) return []

  const generator = d3contours().size([width, height]).thresholds([0.5]).smooth(true)
  const multis = generator(values as unknown as number[])
  if (!multis.length) return []

  const geom = multis[0] as unknown as {
    type: string
    coordinates: [number, number][][][]
  }
  if (geom.type !== 'MultiPolygon' || !Array.isArray(geom.coordinates) || geom.coordinates.length === 0)
    return []

  const rings: [number, number][][] = []
  for (const poly of geom.coordinates) {
    if (!poly?.length) continue
    const outer = poly[0] as [number, number][]
    if (outer?.length >= 3) rings.push(outer)
  }
  return rings
}

/**
 * Fetches Solar API roof mask GeoTIFF and builds facet polygons (no OpenAI).
 * Returns null if the mask is unavailable or could not be parsed.
 */
export async function tryFacetPayloadsFromSolarRoofMask(options: {
  lat: number
  lng: number
  apiKey: string
  referenceLat: number
  referenceLng: number
  segments: SolarMaskSegment[]
}): Promise<SolarMaskFacetPayload[] | null> {
  const { lat, lng, apiKey, referenceLat, referenceLng, segments } = options

  try {
    const maskUrl = await fetchDataLayersMaskUrl(lat, lng, apiKey)
    if (!maskUrl) return null

    const loaded = await loadMaskRasterAndProjector(maskUrl, apiKey)
    if (!loaded) return null

    const { band0, width, height, pixelToLngLat, lngLatToColRow } = loaded

    let rings = contourRingsFromMask(band0, width, height)
    rings = rings.filter((r) => polygonAreaPx(r) >= MIN_RING_AREA_PX)

    if (rings.length === 0) return null

    const ref = { lat: referenceLat, lng: referenceLng }
    const refPx = lngLatToColRow(referenceLat, referenceLng)

    const scoreRing = (ring: [number, number][]) => {
      const [cx, cy] = ringCentroid(ring)
      const cLngLat = pixelToLngLat(cx, cy)
      const containsPin =
        refPx != null ? pointInPolygonColRow(refPx.col, refPx.row, ring) : false
      const dist = distanceMeters(ref, cLngLat)
      return {
        ring,
        dist,
        areaPx: polygonAreaPx(ring),
        containsPin,
      }
    }

    const scoredAll = rings.map(scoreRing).sort((a, b) => {
      if (a.containsPin !== b.containsPin) return a.containsPin ? -1 : 1
      if (a.dist !== b.dist) return a.dist - b.dist
      return b.areaPx - a.areaPx
    })

    const scored = scoredAll.filter(
      (x) => x.containsPin || x.dist <= 45 || rings.length <= 2
    )

    const picked = (scored.length > 0 ? scored : scoredAll)
      .slice(0, MAX_FACETS)
      .map((x) => ({ ring: x.ring, dist: x.dist, areaPx: x.areaPx }))

    const out: SolarMaskFacetPayload[] = []
    let idx = 0
    for (const item of picked) {
      const simplified = decimateClosedRing(item.ring, MAX_VERTICES_PER_RING)
      if (simplified.length < 4) continue

      const latLngVertices: { lat: number; lng: number }[] = []
      for (let i = 0; i < simplified.length - 1; i++) {
        const [x, y] = simplified[i]
        latLngVertices.push(pixelToLngLat(x, y))
      }

      if (latLngVertices.length < 3) continue

      const centroid = {
        lat: latLngVertices.reduce((s, p) => s + p.lat, 0) / latLngVertices.length,
        lng: latLngVertices.reduce((s, p) => s + p.lng, 0) / latLngVertices.length,
      }
      const nearest = nearestSegment(centroid, segments)
      const seg = nearest?.segment ?? null
      const estSqFt = Math.round(planarPolygonAreaSqFt(latLngVertices))

      out.push({
        id: `solar_mask_${idx++}`,
        vertices: [],
        lat_lng_vertices: latLngVertices,
        confidence: 0.92,
        estimated_sq_ft: estSqFt > 0 ? estSqFt : null,
        solar_segment_index: seg?.segment_index ?? null,
        suggested_pitch_degrees: seg?.pitch_degrees ?? null,
        suggested_azimuth_degrees: seg?.azimuth_degrees ?? null,
        suggested_ground_area_sqft:
          typeof seg?.ground_area_m2 === 'number' ? seg.ground_area_m2 * 10.7639 : null,
        facet_source: 'solar_mask',
      })
    }

    return out.length > 0 ? out : null
  } catch (e) {
    console.warn('[solar-mask] unexpected error:', e)
    return null
  }
}
