import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireAuthApi } from '@/lib/auth'
import { getBitmapDimensionsFromBase64 } from '@/lib/png-dimensions-from-base64'
import { computeStaticLogicalSize, fetchStaticSatelliteMapBase64 } from '@/lib/static-satellite-map'
import { ROOF_MEASURE_VISION_TRACE_ENABLED } from '@/lib/roof-measure-flags'
import { tryFacetPayloadsFromSolarRoofMask } from '@/lib/solar-roof-mask-facets'

type PixelPoint = [number, number]

type RawFacet = {
  id: string
  vertices: PixelPoint[]
  confidence: number
  estimated_sq_ft?: number
  /** When present, ties this facet to a Google Solar roofSegmentStats index. */
  solar_segment_index?: number
}

type RawLine = {
  id: string
  points: PixelPoint[]
  confidence: number
}

type RawDetection = {
  facets: RawFacet[]
  ridges: RawLine[]
  valleys: RawLine[]
  step_flashing: RawLine[]
  wall_flashing: RawLine[]
  notes: string
}

type RawLocalization = {
  x1: number
  y1: number
  x2: number
  y2: number
  confidence: number
  notes?: string
}

type SolarRoofSegment = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  area_m2: number | null
  ground_area_m2: number | null
  center: { lat: number; lng: number } | null
  bounding_box: {
    sw: { lat: number; lng: number }
    ne: { lat: number; lng: number }
  } | null
}

type SolarContext = {
  anchor: { lat: number; lng: number } | null
  segments: SolarRoofSegment[]
}

type MapBounds = { north: number; south: number; east: number; west: number }

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function latLngToWorldPixel(lat: number, lng: number, zoom: number) {
  const scale = 256 * Math.pow(2, zoom)
  const sinLat = clamp(Math.sin((lat * Math.PI) / 180), -0.9999, 0.9999)
  const x = ((lng + 180) / 360) * scale
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  return { x, y }
}

function worldPixelToLatLng(x: number, y: number, zoom: number) {
  const scale = 256 * Math.pow(2, zoom)
  const lng = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

function pixelToLatLng(
  px: number,
  py: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
) {
  const centerWorld = latLngToWorldPixel(centerLat, centerLng, zoom)
  const worldX = centerWorld.x + (px - imageWidth / 2)
  const worldY = centerWorld.y + (py - imageHeight / 2)
  return worldPixelToLatLng(worldX, worldY, zoom)
}

function latLngToPixel(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
): PixelPoint {
  const centerWorld = latLngToWorldPixel(centerLat, centerLng, zoom)
  const world = latLngToWorldPixel(lat, lng, zoom)
  const px = world.x - centerWorld.x + imageWidth / 2
  const py = world.y - centerWorld.y + imageHeight / 2
  return [px, py]
}

function expandBounds(b: MapBounds, padFraction: number): MapBounds {
  const latPad = (b.north - b.south) * padFraction
  const lngPad = (b.east - b.west) * padFraction
  return {
    north: Math.min(90, b.north + latPad),
    south: Math.max(-90, b.south - latPad),
    east: b.east + lngPad,
    west: b.west - lngPad,
  }
}

function centroidInExpandedBounds(
  lat: number,
  lng: number,
  b: MapBounds,
  padFraction: number
): boolean {
  const e = expandBounds(b, padFraction)
  return lat <= e.north && lat >= e.south && lng <= e.east && lng >= e.west
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toDataUrl(imageBase64: string): string {
  if (imageBase64.startsWith('data:image/')) return imageBase64
  return `data:image/png;base64,${imageBase64}`
}

function extractLatLng(value: any): { lat: number; lng: number } | null {
  if (!value || typeof value.latitude !== 'number' || typeof value.longitude !== 'number') return null
  return { lat: value.latitude, lng: value.longitude }
}

function distanceBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const latDiff = a.lat - b.lat
  const lngDiff = a.lng - b.lng
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusMeters = 6371000
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function distanceFeet(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return distanceMeters(a, b) * 3.28084
}

/** Planar m² at mean latitude → sq ft (adequate for small roof polygons). */
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

function polygonCentroid(vertices: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const n = vertices.length
  return {
    lat: vertices.reduce((s, p) => s + p.lat, 0) / n,
    lng: vertices.reduce((s, p) => s + p.lng, 0) / n,
  }
}

function pointInPolygonLngLat(pt: { lat: number; lng: number }, ring: { lat: number; lng: number }[]): boolean {
  if (ring.length < 3) return false
  const py = pt.lat
  const px = pt.lng
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng
    const yi = ring[i].lat
    const xj = ring[j].lng
    const yj = ring[j].lat
    const denom = yj - yi
    if (Math.abs(denom) < 1e-14) continue
    if ((yi > py) !== (yj > py)) {
      const xInt = ((xj - xi) * (py - yi)) / denom + xi
      if (px < xInt) inside = !inside
    }
  }
  return inside
}

function mapBoundsMaxFootprintSqFt(bounds: MapBounds): number {
  const midLat = (bounds.north + bounds.south) / 2
  const wM = distanceMeters({ lat: midLat, lng: bounds.west }, { lat: midLat, lng: bounds.east })
  const hM = distanceMeters({ lat: bounds.south, lng: midLat }, { lat: bounds.north, lng: midLat })
  return Math.abs(wM * hM * 10.7639)
}

type FacetResponsePayload = {
  id: string
  vertices: PixelPoint[]
  lat_lng_vertices: { lat: number; lng: number }[]
  confidence: number
  estimated_sq_ft: number | null
  solar_segment_index: number | null
  suggested_pitch_degrees: number | null
  suggested_azimuth_degrees: number | null
  suggested_ground_area_sqft: number | null
  facet_source?: string
}

/** Bbox quads are not pin-filtered in `lib/solar-roof-mask-facets`; mask split facets already are. */
const TARGET_PIN_MAX_METERS = 24
const TARGET_CLUSTER_MAX_METERS = 22
const SOLAR_ANCHOR_FALLBACK_MAX_METERS = 70

function filterFacetsToRequestedStructure(
  facets: FacetResponsePayload[],
  requestedCenter: { lat: number; lng: number }
): FacetResponsePayload[] {
  if (facets.length === 0) return facets

  const scored = facets
    .map((facet) => {
      const vertices = facet.lat_lng_vertices
      if (!vertices || vertices.length < 3) return null
      const centroid = polygonCentroid(vertices)
      return {
        facet,
        centroid,
        inside: pointInPolygonLngLat(requestedCenter, vertices),
        dist: distanceMeters(requestedCenter, centroid),
        area: planarPolygonAreaSqFt(vertices),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const primary =
    scored
      .filter((item) => item.inside || item.dist <= TARGET_PIN_MAX_METERS)
      .sort((a, b) => {
        if (a.inside !== b.inside) return a.inside ? -1 : 1
        return a.dist - b.dist
      })[0] ?? null

  if (!primary) return []

  return scored
    .filter((item) => {
      if (item.inside || item.dist <= TARGET_PIN_MAX_METERS) return true
      return distanceMeters(item.centroid, primary.centroid) <= TARGET_CLUSTER_MAX_METERS
    })
    .sort((a, b) => b.area - a.area)
    .map((item) => item.facet)
}

/** One lat/lng quad per Google Solar segment (engineering footprint). No OpenAI. */
function buildSolarPlaneFacetPayloads(
  segments: SolarRoofSegment[],
  validBounds: MapBounds | null
): FacetResponsePayload[] {
  const out: FacetResponsePayload[] = []
  for (const seg of segments) {
    const box = seg.bounding_box
    if (!box) continue
    const { ne, sw } = box
    if (!(ne.lat > sw.lat) || !(ne.lng > sw.lng)) continue

    const nw = { lat: ne.lat, lng: sw.lng }
    const se = { lat: sw.lat, lng: ne.lng }
    const latLngVertices = [nw, ne, se, sw]

    const cLat = latLngVertices.reduce((s, p) => s + p.lat, 0) / 4
    const cLng = latLngVertices.reduce((s, p) => s + p.lng, 0) / 4
    if (validBounds && !centroidInExpandedBounds(cLat, cLng, validBounds, 0.18)) continue

    const estSqFt =
      typeof seg.ground_area_m2 === 'number'
        ? Math.round(seg.ground_area_m2 * 10.7639)
        : typeof seg.area_m2 === 'number'
          ? Math.round(seg.area_m2 * 10.7639)
          : null

    out.push({
      id: `solar_plane_${seg.segment_index}`,
      vertices: [],
      lat_lng_vertices: latLngVertices,
      confidence: 0.35,
      estimated_sq_ft: estSqFt,
      solar_segment_index: seg.segment_index,
      suggested_pitch_degrees: seg.pitch_degrees,
      suggested_azimuth_degrees: seg.azimuth_degrees,
      suggested_ground_area_sqft:
        typeof seg.ground_area_m2 === 'number' ? seg.ground_area_m2 * 10.7639 : null,
      facet_source: 'solar_bbox',
    })
  }
  return out
}

const MIN_FACET_SQFT = 35
const MAX_FACET_SQFT = 4000
/**
 * Near-duplicate: same real plane traced twice (centroids almost on top of each other).
 * Keep this tight: adjacent roof-strip centroids are often under 15 ft apart; 14 ft was merging distinct planes.
 */
const DUPLICATE_CENTROID_FT = 6.5
/** Require similar-sized polygons to count as a double-trace; distinct roof faces often differ more in area. */
const DUPLICATE_AREA_RATIO = 0.75
/** Sum of facet footprint areas should not exceed ~1.32× visible map footprint (guards stacked overlaps). */
const SUM_AREA_VS_VIEWPORT_FACTOR = 1.32
/**
 * When Solar reports per-segment ground area, summed footprint is a strong anchor for typical homes (~20–30 squares).
 * Allow modest vision overshoot but block 3–5× inflation from overlapping facets.
 */
const SUM_AREA_VS_SOLAR_GROUND_FACTOR = 1.32
/** Vision traces can legitimately exceed Solar ground_area sum when Google merged segments; slightly looser cap so real planes are not trimmed. */
const SUM_AREA_VS_SOLAR_GROUND_FACTOR_VISION = 1.48

/**
 * If facet A's centroid lies inside facet B, drop A only when A is a **small** sliver vs B. Middle roof strips
 * can sit inside a loose vision hull; 0.26 was high enough to drop a real face (~15–20% of the hull).
 */
const NESTED_CENTROID_DUPLICATE_MAX_FRAC = 0.1

/** Sum of segment ground_area_m² → sq ft (roof footprint; comparable to flat facet totals before pitch). */
function solarGroundFootprintTotalSqFt(segments: SolarRoofSegment[]): number | null {
  let sumM2 = 0
  let n = 0
  for (const s of segments) {
    if (typeof s.ground_area_m2 === 'number' && s.ground_area_m2 > 0) {
      sumM2 += s.ground_area_m2
      n++
    }
  }
  if (n === 0) return null
  return sumM2 * 10.7639
}

function dedupeAndCapFacetFootprints(
  facets: FacetResponsePayload[],
  validBounds: MapBounds | null,
  solarGroundFootprintSqFt: number | null,
  opts?: { solarGroundSumFactor?: number; /** Vision facet sums often exceed merged Solar `ground_area` total. */ skipSolarFootprintCap?: boolean }
): { facets: FacetResponsePayload[]; dropped_note: string | null } {
  const solarSumFactor = opts?.solarGroundSumFactor ?? SUM_AREA_VS_SOLAR_GROUND_FACTOR
  const withArea = facets
    .map((f) => ({
      facet: f,
      area: planarPolygonAreaSqFt(f.lat_lng_vertices),
      centroid: polygonCentroid(f.lat_lng_vertices),
    }))
    .filter((x) => x.facet.lat_lng_vertices.length >= 3 && x.area >= MIN_FACET_SQFT && x.area <= MAX_FACET_SQFT)

  const sorted = [...withArea].sort((a, b) => (b.facet.confidence || 0) - (a.facet.confidence || 0))
  const kept: typeof withArea = []

  for (const item of sorted) {
    const { facet, area, centroid } = item
    const enclosedAsTinyNested = kept.some((k) => {
      if (!pointInPolygonLngLat(centroid, k.facet.lat_lng_vertices)) return false
      const kArea = planarPolygonAreaSqFt(k.facet.lat_lng_vertices)
      if (!(kArea > 0)) return false
      return area / kArea < NESTED_CENTROID_DUPLICATE_MAX_FRAC
    })
    if (enclosedAsTinyNested) continue

    const nearDuplicate = kept.some((k) => {
      const d = distanceFeet(centroid, k.centroid)
      if (d > DUPLICATE_CENTROID_FT) return false
      const ratio = Math.min(area, k.area) / Math.max(area, k.area)
      return ratio >= DUPLICATE_AREA_RATIO
    })
    if (nearDuplicate) continue

    kept.push(item)
  }

  let result = kept.map((k) => k.facet)

  let footprintCap: number | null = null
  if (validBounds) {
    const viewportCap = mapBoundsMaxFootprintSqFt(validBounds) * SUM_AREA_VS_VIEWPORT_FACTOR
    if (viewportCap > 500) footprintCap = viewportCap
  }
  if (
    !opts?.skipSolarFootprintCap &&
    solarGroundFootprintSqFt != null &&
    solarGroundFootprintSqFt >= 350 &&
    Number.isFinite(solarGroundFootprintSqFt)
  ) {
    const solarCap = solarGroundFootprintSqFt * solarSumFactor
    footprintCap = footprintCap == null ? solarCap : Math.min(footprintCap, solarCap)
  }

  if (footprintCap != null && footprintCap > 400 && result.length > 0) {
    let sum = result.reduce((s, f) => s + planarPolygonAreaSqFt(f.lat_lng_vertices), 0)
    if (sum > footprintCap) {
      const again = [...kept].sort((a, b) => {
        if (b.area !== a.area) return b.area - a.area
        return (b.facet.confidence || 0) - (a.facet.confidence || 0)
      })
      const trimmed: FacetResponsePayload[] = []
      sum = 0
      for (const item of again) {
        const a = planarPolygonAreaSqFt(item.facet.lat_lng_vertices)
        if (sum + a <= footprintCap) {
          trimmed.push(item.facet)
          sum += a
        }
      }
      if (trimmed.length < result.length) {
        result = trimmed
      }
    }
  }

  const dropped = facets.length - result.length
  const dropped_note =
    dropped > 0
      ? `${dropped} overlapping or out-of-range facet(s) removed so totals are not inflated. Review remaining planes and draw any missing faces manually.`
      : null

  return { facets: result, dropped_note }
}

function getSolarAnchor(segments: SolarRoofSegment[]): { lat: number; lng: number } | null {
  const centers = segments
    .map((segment) => segment.center)
    .filter((center): center is { lat: number; lng: number } => Boolean(center))

  if (centers.length === 0) return null

  return centers.reduce(
    (acc, center) => ({
      lat: acc.lat + center.lat / centers.length,
      lng: acc.lng + center.lng / centers.length,
    }),
    { lat: 0, lng: 0 }
  )
}

async function fetchGoogleSolarContext(lat: number, lng: number): Promise<SolarContext> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!mapsKey) return { anchor: null, segments: [] }

  const url =
    `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
    `?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${mapsKey}`

  const response = await fetch(url)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn(
      '[detect-roof] Google Solar buildingInsights failed:',
      response.status,
      detail?.slice(0, 200) || ''
    )
    return { anchor: null, segments: [] }
  }

  const data = await response.json().catch(() => null)
  const buildingCenter = extractLatLng(data?.center)
  const roofSegments = Array.isArray(data?.solarPotential?.roofSegmentStats)
    ? data.solarPotential.roofSegmentStats
    : []

  const segments = roofSegments.map((segment: any, index: number) => ({
    segment_index: index,
    pitch_degrees: typeof segment.pitchDegrees === 'number' ? segment.pitchDegrees : null,
    azimuth_degrees: typeof segment.azimuthDegrees === 'number' ? segment.azimuthDegrees : null,
    area_m2: typeof segment?.stats?.areaMeters2 === 'number' ? segment.stats.areaMeters2 : null,
    ground_area_m2: typeof segment?.stats?.groundAreaMeters2 === 'number' ? segment.stats.groundAreaMeters2 : null,
    center: extractLatLng(segment.center),
    bounding_box:
      segment?.boundingBox?.sw &&
      segment?.boundingBox?.ne &&
      extractLatLng(segment.boundingBox.sw) &&
      extractLatLng(segment.boundingBox.ne)
        ? {
            sw: extractLatLng(segment.boundingBox.sw) as { lat: number; lng: number },
            ne: extractLatLng(segment.boundingBox.ne) as { lat: number; lng: number },
          }
        : null,
  }))

  return {
    anchor: buildingCenter || getSolarAnchor(segments),
    segments,
  }
}

function buildSolarPrompt(segments: SolarRoofSegment[]): string {
  if (segments.length === 0) {
    return 'No Google Solar roof-segment data available. Infer polygons only from the visible roof edges in the image.'
  }

  const simplified = segments.slice(0, 20).map((segment) => ({
    segment_index: segment.segment_index,
    pitch_degrees: segment.pitch_degrees,
    azimuth_degrees: segment.azimuth_degrees,
    area_m2: segment.area_m2,
    ground_area_m2: segment.ground_area_m2,
    center: segment.center,
    bounding_box: segment.bounding_box,
  }))

  return `Google Solar roof segment metadata is available.
Use Solar only as a secondary hint for pitch/orientation and rough segment count.
Do NOT place polygons from Solar centers or bounding boxes alone.
Polygon coordinates must follow the visible roof edges in the satellite image first.
If Solar and imagery disagree, trust the visible roof edges.
Solar segments:
${JSON.stringify(simplified)}`
}

type SolarPixelPlaneHint = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  pixel_region: { x_min: number; y_min: number; x_max: number; y_max: number }
}

function buildSolarPixelPlaneHints(
  segments: SolarRoofSegment[],
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number,
  validBounds: MapBounds | null
): SolarPixelPlaneHint[] {
  const hints: SolarPixelPlaneHint[] = []
  const pad = 10

  for (const seg of segments) {
    const box = seg.bounding_box
    if (!box) continue
    const { ne, sw } = box
    if (!(ne.lat > sw.lat) || !(ne.lng > sw.lng)) continue

    const nw = { lat: ne.lat, lng: sw.lng }
    const se = { lat: sw.lat, lng: ne.lng }
    const corners = [nw, ne, se, sw]

    let xMin = Infinity
    let yMin = Infinity
    let xMax = -Infinity
    let yMax = -Infinity
    for (const c of corners) {
      const [px, py] = latLngToPixel(c.lat, c.lng, centerLat, centerLng, zoom, imageWidth, imageHeight)
      xMin = Math.min(xMin, px)
      yMin = Math.min(yMin, py)
      xMax = Math.max(xMax, px)
      yMax = Math.max(yMax, py)
    }

    const rx0 = clamp(Math.floor(xMin - pad), 0, imageWidth - 1)
    const ry0 = clamp(Math.floor(yMin - pad), 0, imageHeight - 1)
    const rx1 = clamp(Math.ceil(xMax + pad), 0, imageWidth - 1)
    const ry1 = clamp(Math.ceil(yMax + pad), 0, imageHeight - 1)
    if (rx1 - rx0 < 12 || ry1 - ry0 < 12) continue

    const cLat = corners.reduce((s, p) => s + p.lat, 0) / 4
    const cLng = corners.reduce((s, p) => s + p.lng, 0) / 4
    if (validBounds && !centroidInExpandedBounds(cLat, cLng, validBounds, 0.18)) continue

    hints.push({
      segment_index: seg.segment_index,
      pitch_degrees: seg.pitch_degrees,
      azimuth_degrees: seg.azimuth_degrees,
      pixel_region: { x_min: rx0, y_min: ry0, x_max: rx1, y_max: ry1 },
    })
  }

  return hints
}

/** User-message block for facet detection: Solar bboxes → pixel hints; vision draws real polygons. */
function buildSolarFacetDetectionPromptText(segments: SolarRoofSegment[], hints: SolarPixelPlaneHint[]): string {
  if (hints.length === 0) {
    if (segments.length === 0) {
      return 'No Google Solar roof-segment data for this location. Infer roof facets only from visible roof edges in the image.'
    }
    return `Google Solar lists ${segments.length} segment(s) but none map cleanly to this image frame. Infer roof facets from visible edges only (hips, gables, eaves, rakes, valleys). Do not use axis-aligned placeholder rectangles on lawns or trees.
Solar summary (no pixel hints):
${JSON.stringify(
  segments.slice(0, 20).map((s) => ({
    segment_index: s.segment_index,
    pitch_degrees: s.pitch_degrees,
    azimuth_degrees: s.azimuth_degrees,
  }))
)}`
  }

  return `Google Solar identified ${hints.length} roof plane(s) for this address. Each entry maps a segment_index to a loose pixel_region in THIS image (same coordinate system as your vertices: x 0..width-1 left→right, y 0..height-1 top→bottom).

FACET GEOMETRY (critical):
- Output **one facet per visible distinct roof plane** in the imagery. If you see **more** planes than Solar hints (common: porch roof, extra gable, or Google merged segments), add facets for those too and set solar_segment_index to **-1** for planes with no matching hint.
- For each facet that clearly matches a hint, set solar_segment_index to that segment_index (integer).
- Trace the actual roof outline from the imagery (eaves, rakes, ridges, valleys). Use **at least 5 vertices per facet** (often 6–14 on hips/gables). **Never** default to a 4-corner quadrilateral or axis-aligned rectangle.
- Do NOT output axis-aligned rectangles, squares, or the pixel_region border as the polygon. The region is only a search hint.
- Rotate and shear polygons to match the roof in the photo; do not force edges parallel to the image frame unless the roof truly appears that way.
- Where two planes meet, align shared boundaries; avoid large overlaps between facets. Do not cover trees, driveways, or lawn with roof facets.
- Do not emit one rectangle per Solar hint if those regions describe the same roof — merge into non-overlapping planes only.

Plane hints:
${JSON.stringify(hints)}`
}

/** OpenAI strict JSON schema for roof trace (enforces ≥5 vertices per facet). */
const ROOF_DETECTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['facets', 'ridges', 'valleys', 'step_flashing', 'wall_flashing', 'notes'],
  properties: {
    facets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'vertices', 'confidence', 'estimated_sq_ft', 'solar_segment_index'],
        properties: {
          id: { type: 'string' },
          vertices: {
            type: 'array',
            minItems: 5,
            maxItems: 28,
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
          },
          confidence: { type: 'number' },
          estimated_sq_ft: {
            type: 'number',
            description: 'Footprint-style sq ft estimate for this plane, or 0 if unknown.',
          },
          solar_segment_index: {
            type: 'integer',
            description: 'Google Solar roofSegmentStats index from the user message, or -1 if unknown / not applicable.',
          },
        },
      },
    },
    ridges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'points', 'confidence'],
        properties: {
          id: { type: 'string' },
          points: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
          },
          confidence: { type: 'number' },
        },
      },
    },
    valleys: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'points', 'confidence'],
        properties: {
          id: { type: 'string' },
          points: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
          },
          confidence: { type: 'number' },
        },
      },
    },
    step_flashing: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'points', 'confidence'],
        properties: {
          id: { type: 'string' },
          points: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
          },
          confidence: { type: 'number' },
        },
      },
    },
    wall_flashing: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'points', 'confidence'],
        properties: {
          id: { type: 'string' },
          points: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
          },
          confidence: { type: 'number' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

function normalizeStructuredRoofDetection(parsed: RawDetection): RawDetection {
  const facets = (parsed.facets ?? []).map((f) => {
    const out: RawFacet = {
      id: f.id,
      vertices: Array.isArray(f.vertices) ? f.vertices : [],
      confidence: f.confidence,
    }
    if (typeof f.estimated_sq_ft === 'number' && f.estimated_sq_ft > 0) {
      out.estimated_sq_ft = f.estimated_sq_ft
    }
    if (typeof f.solar_segment_index === 'number' && Number.isFinite(f.solar_segment_index)) {
      const idx = Math.round(f.solar_segment_index)
      out.solar_segment_index = idx >= 0 ? idx : -1
    }
    return out
  })
  return {
    facets,
    ridges: parsed.ridges ?? [],
    valleys: parsed.valleys ?? [],
    step_flashing: parsed.step_flashing ?? [],
    wall_flashing: parsed.wall_flashing ?? [],
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  }
}

async function callDetectionModel(
  imageBase64: string,
  imagePixelDesc: string,
  targetingNote: string,
  solarFacetPrompt: string
): Promise<RawDetection> {
  const systemPrompt = `You are a roofing measurement AI.
Analyze a satellite image and identify:
- roof facets (polygons following real roof edges — not generic rectangles on the ground)
- ridges (lines)
- valleys (lines)
- flashing where visible

Output must conform to the response JSON schema (strict). Every facet MUST have at least 5 vertices (the schema enforces this). Place vertices along visible eaves, rakes, hips, and valleys—not axis-aligned bounding boxes.

Use solar_segment_index from the user message when a facet matches a listed Solar plane; otherwise use -1. Use estimated_sq_ft 0 when unknown.

Rules:
- The image is high-DPI satellite (logical size given in the user message). x is 0..width-1, y is 0..height-1, (0,0) top-left.
- Facets: closed polygons tracing **visible** roof edges. Typical planes need 6–14 vertices on hips/gables. Never use only 4 corners unless the roof is literally a featureless rectangle (rare).
- Draw roof facets only over actual shingle/metal roof surfaces you can see. Do not output placeholder grids, axis-aligned boxes on lawns, or “default” shapes in empty areas.
- Trace only real roof planes and edges visible in the image; do not invent roofs over trees, driveways, or lawns.
- Clip each facet to the **roof deck only**: never extend a polygon onto driveway, walkway, porch floor, pool deck, or lawn—even if a Solar pixel_region is loose.
- Focus on the main residence roof(s); ignore wooded areas unless a roof is clearly visible there.
- Include low confidence items (<0.65) only when you still see a plausible roof edge.
- NON-OVERLAP: Each facet is one physical roof plane. Do not stack multiple polygons on the same **visible** face. Merge only when two polygons are clearly the **same** shingle plane; keep **separate** facets for distinct pitches, cross gables, porches, and shed roofs even if one polygon is smaller.
- Prefer 3–8 facets on a typical home. Avoid 9+ separate facets unless you clearly see distinct structures (e.g. main house + detached garage).`

  const dataUrl = toDataUrl(imageBase64)
  const openai = getOpenAI()

  const userText = (retry: boolean) =>
    retry
      ? `Return strictly valid JSON only. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${solarFacetPrompt}`
      : `Analyze this roof satellite image. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${solarFacetPrompt}`

  const messages = (retry: boolean) => [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: userText(retry) },
        { type: 'image_url' as const, image_url: { url: dataUrl } },
      ],
    },
  ]

  const parseCompletion = (content: string): RawDetection => {
    const parsed = safeJsonParse<RawDetection>(content)
    if (!parsed) throw new Error('Invalid JSON from model')
    return normalizeStructuredRoofDetection(parsed)
  }

  const attemptStructured = async (retry: boolean) => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'roof_detection',
          strict: true,
          schema: ROOF_DETECTION_JSON_SCHEMA,
        },
      },
      temperature: 0,
      messages: messages(retry),
      max_tokens: 3600,
    })
    const content = completion.choices?.[0]?.message?.content || ''
    return parseCompletion(content)
  }

  const attemptLoose = async (retry: boolean) => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: messages(retry),
      max_tokens: 3600,
    })
    const content = completion.choices?.[0]?.message?.content || ''
    return parseCompletion(content)
  }

  try {
    return await attemptStructured(false)
  } catch (e) {
    console.warn('[detect-roof] structured roof_detection failed, retry structured:', e)
  }
  try {
    return await attemptStructured(true)
  } catch (e) {
    console.warn('[detect-roof] structured roof_detection retry failed, fallback json_object:', e)
  }
  try {
    return await attemptLoose(false)
  } catch {
    return await attemptLoose(true)
  }
}

async function callLocalizationModel(
  imageBase64: string,
  solarSegments: SolarRoofSegment[],
  imagePixelDesc: string,
  targetingNote: string
): Promise<RawLocalization | null> {
  const systemPrompt = `You are a roofing measurement AI.
Find the single target residential structure in a satellite image before roof measurement begins.

Return ONLY JSON:
{
  "x1": 100,
  "y1": 120,
  "x2": 340,
  "y2": 360,
  "confidence": 0.93,
  "notes": ""
}

Rules:
- Return one bounding box for the full target house roof footprint only.
- The target should be the main residential structure nearest the image center unless the user guidance says it is centered already.
- Ignore roads, lawns, trees, detached sheds, neighboring homes, and commercial buildings.
- Coordinates are pixels in the image.`

  const dataUrl = toDataUrl(imageBase64)
  const openai = getOpenAI()

  const attempt = async (retry = false) => {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: retry
                ? `Return strictly valid JSON only. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${buildSolarPrompt(solarSegments)}`
                : `Find the target house in this satellite image. Image pixel dimensions: ${imagePixelDesc}. ${targetingNote}\n\n${buildSolarPrompt(solarSegments)}`,
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 400,
    })

    const content = completion.choices?.[0]?.message?.content || ''
    return safeJsonParse<RawLocalization>(content)
  }

  try {
    return await attempt(false)
  } catch {
    return await attempt(true)
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthApi()

    const body = await request.json().catch(() => ({}))
    const {
      imageBase64,
      lat,
      lng,
      zoom,
      opportunityId,
      mapBounds,
      mapWidthPx,
      mapHeightPx,
      detectionMode,
    } = body as {
      imageBase64?: string
      lat?: number
      lng?: number
      zoom?: number
      opportunityId?: string
      mapBounds?: { north: number; south: number; east: number; west: number }
      mapWidthPx?: number
      mapHeightPx?: number
      /** Default `solar`: Google Solar segment boxes only (no OpenAI). `vision`: satellite + GPT-4o (costs tokens). */
      detectionMode?: 'solar' | 'vision'
    }

    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof zoom !== 'number') {
      return NextResponse.json({ error: 'lat, lng, zoom required' }, { status: 400 })
    }
    if (typeof opportunityId !== 'string') {
      return NextResponse.json({ error: 'opportunityId required' }, { status: 400 })
    }

    const normalizedZoom = Math.round(zoom)
    const requestedCenter = { lat, lng }
    const solarContext = await fetchGoogleSolarContext(lat, lng)
    const validBounds =
      mapBounds &&
      typeof mapBounds.north === 'number' &&
      typeof mapBounds.south === 'number' &&
      typeof mapBounds.east === 'number' &&
      typeof mapBounds.west === 'number' &&
      mapBounds.north > mapBounds.south
        ? (mapBounds as MapBounds)
        : null

    const alignWithClientMap = Boolean(validBounds)

    const solarAnchorDistance =
      solarContext.anchor ? distanceMeters(requestedCenter, solarContext.anchor) : null
    const shouldUseSolarAnchor =
      !alignWithClientMap &&
      Boolean(
        solarContext.anchor &&
          solarAnchorDistance !== null &&
          solarAnchorDistance <= 120 &&
          (!validBounds || centroidInExpandedBounds(solarContext.anchor.lat, solarContext.anchor.lng, validBounds, 0.1))
      )

    const captureCenter = shouldUseSolarAnchor && solarContext.anchor ? solarContext.anchor : requestedCenter
    const detectionZoomBase = shouldUseSolarAnchor
      ? Math.min(22, Math.max(21, normalizedZoom + 1))
      : Math.min(22, Math.max(21, normalizedZoom))

    const solarSegments = solarContext.segments
    const { sizeW: logicalSizeW, sizeH: logicalSizeH } = computeStaticLogicalSize(mapWidthPx, mapHeightPx)
    const imageWidth = logicalSizeW * 2
    const imageHeight = logicalSizeH * 2
    const imagePixelDesc = `${imageWidth}×${imageHeight} (x: 0–${imageWidth - 1}, y: 0–${imageHeight - 1})`

    const useVision = detectionMode === 'vision'
    if (useVision && !ROOF_MEASURE_VISION_TRACE_ENABLED) {
      return NextResponse.json(
        {
          error:
            'AI roof trace is temporarily disabled. Use “Load roof (Google Solar)” or draw facets on the map.',
        },
        { status: 503 }
      )
    }
    const solarGroundFootprintSqFtEarly = solarGroundFootprintTotalSqFt(solarSegments)

    /** Default path: Solar roof mask GeoTIFF when available — $0 LLM. */
    if (!useVision) {
      const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

      let solarFacets: FacetResponsePayload[] = []
      let solarReferenceForFilter = requestedCenter
      let usedSolarAnchorFallback = false
      if (mapsKey) {
        const maskFacets = await tryFacetPayloadsFromSolarRoofMask({
          lat: captureCenter.lat,
          lng: captureCenter.lng,
          apiKey: mapsKey,
          /** Prefer outlines enclosing the pin the user actually placed (may differ slightly from Solar anchor). */
          referenceLat: requestedCenter.lat,
          referenceLng: requestedCenter.lng,
          segments: solarSegments,
        })
        if (maskFacets && maskFacets.length > 0) {
          solarFacets = maskFacets as FacetResponsePayload[]
        }
        if (
          solarFacets.length === 0 &&
          solarContext.anchor &&
          solarAnchorDistance !== null &&
          solarAnchorDistance <= SOLAR_ANCHOR_FALLBACK_MAX_METERS
        ) {
          const anchorMaskFacets = await tryFacetPayloadsFromSolarRoofMask({
            lat: solarContext.anchor.lat,
            lng: solarContext.anchor.lng,
            apiKey: mapsKey,
            referenceLat: solarContext.anchor.lat,
            referenceLng: solarContext.anchor.lng,
            segments: solarSegments,
          })
          if (anchorMaskFacets && anchorMaskFacets.length > 0) {
            solarFacets = anchorMaskFacets as FacetResponsePayload[]
            solarReferenceForFilter = solarContext.anchor
            usedSolarAnchorFallback = true
          }
        }
      }

      if (solarFacets.length === 0) {
        solarFacets = buildSolarPlaneFacetPayloads(solarSegments, validBounds)
      }

      if (solarFacets.length > 0) {
        const facetsFiltered = validBounds
          ? solarFacets.filter((facet) => {
              const vs = facet.lat_lng_vertices
              if (!vs || vs.length === 0) return false
              const cLat = vs.reduce((s, p) => s + p.lat, 0) / vs.length
              const cLng = vs.reduce((s, p) => s + p.lng, 0) / vs.length
              return centroidInExpandedBounds(cLat, cLng, validBounds, 0.12)
            })
          : solarFacets

        const mapCandidates = facetsFiltered.length > 0 ? facetsFiltered : solarFacets
        const maskAlreadyPinFiltered =
          mapCandidates.length > 0 &&
          mapCandidates.every((f) => f.facet_source === 'solar_mask_plane')
        const targetFacets = maskAlreadyPinFiltered
          ? mapCandidates
          : filterFacetsToRequestedStructure(mapCandidates, solarReferenceForFilter)
        const fallbackTargetFacets =
          targetFacets.length === 0 &&
          !usedSolarAnchorFallback &&
          solarContext.anchor &&
          solarAnchorDistance !== null &&
          solarAnchorDistance <= SOLAR_ANCHOR_FALLBACK_MAX_METERS
            ? filterFacetsToRequestedStructure(mapCandidates, solarContext.anchor)
            : targetFacets
        if (fallbackTargetFacets !== targetFacets) {
          solarReferenceForFilter = solarContext.anchor as { lat: number; lng: number }
          usedSolarAnchorFallback = true
        }
        const { facets: facetsOut, dropped_note } = dedupeAndCapFacetFootprints(
          fallbackTargetFacets,
          validBounds,
          solarGroundFootprintSqFtEarly
        )

        if (facetsOut.length === 0) {
          return NextResponse.json({
            facets: [],
            ridges: [],
            valleys: [],
            step_flashing: [],
            wall_flashing: [],
            notes:
              'Google Solar returned geometry for this area, but nothing passed the map-pin / overlap filters. Center the pin on the house and try again, use AI trace roof, or draw facets manually.',
            solar_segments: solarSegments,
            solar_ground_footprint_sqft: solarGroundFootprintSqFtEarly,
            requested_center: requestedCenter,
            capture_center: captureCenter,
            capture_center_source: alignWithClientMap
              ? 'requested_center'
              : shouldUseSolarAnchor
                ? 'solar_anchor'
                : 'requested_center',
            detection_zoom: normalizedZoom,
            localization: null,
            facet_source: 'none',
            detection_mode: 'solar',
            openai_calls: 0,
            static_map_size: { width: imageWidth, height: imageHeight, logical: `${logicalSizeW}x${logicalSizeH}` },
          })
        }

        const rawFacetSource = facetsOut[0]?.facet_source
        const facetSource =
          rawFacetSource === 'solar_mask_plane' || rawFacetSource === 'solar_mask_whole'
            ? rawFacetSource
            : 'solar_bbox'
        const solarNotes =
          facetSource === 'solar_mask_plane'
            ? 'Roof planes from Google Solar mask (GeoTIFF), split by Solar segment centers so outlines follow real edges instead of axis-aligned boxes. Drag corners to fine-tune. Use “AI trace roof” only if you need GPT from a static map (OpenAI cost).'
            : facetSource === 'solar_mask_whole'
              ? 'Roof outline loaded from Google Solar mask (GeoTIFF). It matched the map pin, but Solar did not provide reliable per-plane splits, so review the outline, split roof planes manually, and set pitch before quoting.'
            : 'Roof planes loaded from Google Solar (no AI vision). Shapes are segment bounding boxes—drag corners to match the satellite roof. Use “AI trace roof” only if you need GPT to redraw from imagery (OpenAI cost).'
        const anchorNote = usedSolarAnchorFallback
          ? `The address pin was ${Math.round(solarAnchorDistance || 0)}m from Google Solar's building center, so the roof was matched to that Solar building anchor. Verify this is the intended structure.`
          : ''
        const notes = [dropped_note, anchorNote, solarNotes].filter(Boolean).join(' ')

        return NextResponse.json({
          facets: facetsOut,
          ridges: [],
          valleys: [],
          step_flashing: [],
          wall_flashing: [],
          notes,
          solar_segments: solarSegments,
          solar_ground_footprint_sqft: solarGroundFootprintSqFtEarly,
          requested_center: requestedCenter,
          capture_center: usedSolarAnchorFallback ? solarReferenceForFilter : captureCenter,
          capture_center_source: alignWithClientMap
            ? 'requested_center'
            : usedSolarAnchorFallback || shouldUseSolarAnchor
              ? 'solar_anchor'
              : 'requested_center',
          detection_zoom: normalizedZoom,
          localization: null,
          facet_source: facetSource,
          detection_mode: 'solar',
          openai_calls: 0,
          static_map_size: { width: imageWidth, height: imageHeight, logical: `${logicalSizeW}x${logicalSizeH}` },
        })
      }

      return NextResponse.json({
        facets: [],
        ridges: [],
        valleys: [],
        step_flashing: [],
        wall_flashing: [],
        notes:
          'No Google Solar roof boxes for this pin (or API unavailable). Center the map on the house and try again, use “AI trace roof” if OpenAI is configured, or draw facets manually.',
        solar_segments: solarSegments,
        solar_ground_footprint_sqft: solarGroundFootprintSqFtEarly,
        requested_center: requestedCenter,
        capture_center: captureCenter,
        capture_center_source: alignWithClientMap
          ? 'requested_center'
          : shouldUseSolarAnchor
            ? 'solar_anchor'
            : 'requested_center',
        detection_zoom: normalizedZoom,
        localization: null,
        facet_source: 'none',
        detection_mode: 'solar',
        openai_calls: 0,
        static_map_size: { width: imageWidth, height: imageHeight, logical: `${logicalSizeW}x${logicalSizeH}` },
      })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error:
            'OPENAI_API_KEY missing. Choose “Load roof (Solar)” when Google Solar has data, or add a key for AI trace mode.',
        },
        { status: 500 }
      )
    }

    const targetingNote =
      'The target house roof should be centered in this image. Trace only the centered residence roof and ignore neighboring roofs, roads, trees, and detached structures.'

    const lineInBounds = (latLngs: { lat: number; lng: number }[]) => {
      if (!validBounds || latLngs.length === 0) return true
      const cLat = latLngs.reduce((s, p) => s + p.lat, 0) / latLngs.length
      const cLng = latLngs.reduce((s, p) => s + p.lng, 0) / latLngs.length
      return centroidInExpandedBounds(cLat, cLng, validBounds, 0.12)
    }

    const localizationNote = shouldUseSolarAnchor
      ? 'The target house should already be close to the image center. Prefer the centered residence and ignore neighboring structures.'
      : 'Choose the main residence nearest the image center and ignore neighboring structures.'

    let localizedCenter = captureCenter
    let finalZoom = detectionZoomBase
    let localization: RawLocalization | null = null

    if (alignWithClientMap) {
      localizedCenter = requestedCenter
      finalZoom = Math.min(22, Math.max(15, normalizedZoom))
    } else {
      const localizationImageBase64 =
        typeof imageBase64 === 'string' && imageBase64.trim().length > 0
          ? imageBase64
          : await fetchStaticSatelliteMapBase64({
              lat: captureCenter.lat,
              lng: captureCenter.lng,
              zoom: detectionZoomBase,
              sizeW: logicalSizeW,
              sizeH: logicalSizeH,
            })

      localization = await callLocalizationModel(
        localizationImageBase64,
        solarSegments,
        imagePixelDesc,
        localizationNote
      )

      if (
        localization &&
        [localization.x1, localization.y1, localization.x2, localization.y2].every((value) => typeof value === 'number')
      ) {
        const x1 = clamp(Math.min(localization.x1, localization.x2), 0, imageWidth)
        const y1 = clamp(Math.min(localization.y1, localization.y2), 0, imageHeight)
        const x2 = clamp(Math.max(localization.x1, localization.x2), 0, imageWidth)
        const y2 = clamp(Math.max(localization.y1, localization.y2), 0, imageHeight)
        const localizedPixelCenterX = (x1 + x2) / 2
        const localizedPixelCenterY = (y1 + y2) / 2
        const localizedWidth = Math.max(1, x2 - x1)
        const localizedHeight = Math.max(1, y2 - y1)

        localizedCenter = pixelToLatLng(
          localizedPixelCenterX,
          localizedPixelCenterY,
          captureCenter.lat,
          captureCenter.lng,
          detectionZoomBase,
          imageWidth,
          imageHeight
        )

        const structureFillRatio = Math.max(localizedWidth, localizedHeight) / Math.min(imageWidth, imageHeight)
        if (structureFillRatio < 0.24) {
          finalZoom = Math.min(22, detectionZoomBase + 2)
        } else if (structureFillRatio < 0.42) {
          finalZoom = Math.min(22, detectionZoomBase + 1)
        } else if (structureFillRatio > 0.8) {
          finalZoom = Math.max(21, detectionZoomBase - 1)
        }
      }
    }

    const detectionImageBase64 =
      typeof imageBase64 === 'string' && imageBase64.trim().length > 0
        ? imageBase64
        : await fetchStaticSatelliteMapBase64({
            lat: localizedCenter.lat,
            lng: localizedCenter.lng,
            zoom: finalZoom,
            sizeW: logicalSizeW,
            sizeH: logicalSizeH,
          })

    const decodedDims = getBitmapDimensionsFromBase64(detectionImageBase64)
    const visionW = decodedDims?.width && decodedDims.width > 0 ? decodedDims.width : imageWidth
    const visionH = decodedDims?.height && decodedDims.height > 0 ? decodedDims.height : imageHeight
    const visionPixelDesc = `${visionW}×${visionH} (x: 0–${visionW - 1}, y: 0–${visionH - 1})`

    const imageCenterX = visionW / 2
    const imageCenterY = visionH / 2
    const centerRadiusPx = Math.hypot(visionW / 2, visionH / 2) * 0.85
    const isNearImageCenter = (points: PixelPoint[]) => {
      if (!points.length) return false
      const centroid = points.reduce(
        (acc, [x, y]) => ({ x: acc.x + Number(x) / points.length, y: acc.y + Number(y) / points.length }),
        { x: 0, y: 0 }
      )
      const dx = centroid.x - imageCenterX
      const dy = centroid.y - imageCenterY
      return Math.sqrt(dx * dx + dy * dy) <= centerRadiusPx
    }

    /** Bitmap center/zoom for pixel ↔ lat/lng (must match the image passed to the vision model). */
    const usingClientImage = typeof imageBase64 === 'string' && imageBase64.trim().length > 0
    const geoCenterForPixels =
      usingClientImage && !alignWithClientMap ? captureCenter : localizedCenter
    const geoZoomForPixels = usingClientImage && !alignWithClientMap ? detectionZoomBase : finalZoom

    const solarPixelHints = buildSolarPixelPlaneHints(
      solarSegments,
      geoCenterForPixels.lat,
      geoCenterForPixels.lng,
      geoZoomForPixels,
      visionW,
      visionH,
      validBounds
    )
    const solarFacetPrompt = buildSolarFacetDetectionPromptText(solarSegments, solarPixelHints)
    const solarHintCount = solarPixelHints.length

    const raw = await callDetectionModel(
      detectionImageBase64,
      visionPixelDesc,
      targetingNote,
      solarFacetPrompt
    )

    /**
     * Vision runs on the Static Maps bitmap (≤640 logical px, scale 2), not the full browser map div.
     * `map.getBounds()` covers a wider area than that snapshot — linear mapping to full bounds stretched
     * facets off the roof. Use Web Mercator from the same center/zoom + decoded bitmap size as the image.
     */
    const pixelToGeoForVision = (x: number, y: number) =>
      pixelToLatLng(x, y, geoCenterForPixels.lat, geoCenterForPixels.lng, geoZoomForPixels, visionW, visionH)

    const facetsMapped: FacetResponsePayload[] = (raw.facets || [])
      .filter((facet) => isNearImageCenter(Array.isArray(facet.vertices) ? facet.vertices : []))
      .map((facet, idx) => {
        const vertices = Array.isArray(facet.vertices) ? facet.vertices : []
        const latLngVertices = vertices.map(([x, y]) => pixelToGeoForVision(Number(x), Number(y)))
        const center =
          latLngVertices.length > 0
            ? latLngVertices.reduce(
                (acc, point) => ({
                  lat: acc.lat + point.lat / latLngVertices.length,
                  lng: acc.lng + point.lng / latLngVertices.length,
                }),
                { lat: 0, lng: 0 }
              )
            : null
        const nearestSolarSegment =
          center && solarSegments.length > 0
            ? solarSegments.reduce<SolarRoofSegment | null>((best, segment) => {
                if (!segment.center) return best
                if (!best || !best.center) return segment
                return distanceBetween(center, segment.center) < distanceBetween(center, best.center) ? segment : best
              }, null)
            : null

        const modelSolarIdx =
          typeof facet.solar_segment_index === 'number' && Number.isFinite(facet.solar_segment_index)
            ? Math.round(facet.solar_segment_index)
            : null
        const segmentByModelIndex =
          modelSolarIdx !== null && modelSolarIdx >= 0
            ? solarSegments.find((s) => s.segment_index === modelSolarIdx)
            : null
        const pitchSegment = modelSolarIdx === -1 ? null : segmentByModelIndex || nearestSolarSegment

        const solarSegmentIndexOut =
          modelSolarIdx === -1
            ? null
            : segmentByModelIndex != null
              ? segmentByModelIndex.segment_index
              : modelSolarIdx == null
                ? nearestSolarSegment?.segment_index ?? null
                : null

        return {
          id: facet.id || `facet_${idx + 1}`,
          vertices,
          lat_lng_vertices: latLngVertices,
          confidence: Number(facet.confidence) || 0,
          estimated_sq_ft: typeof facet.estimated_sq_ft === 'number' ? facet.estimated_sq_ft : null,
          solar_segment_index: solarSegmentIndexOut,
          suggested_pitch_degrees: pitchSegment?.pitch_degrees ?? null,
          suggested_azimuth_degrees: pitchSegment?.azimuth_degrees ?? null,
          suggested_ground_area_sqft:
            typeof pitchSegment?.ground_area_m2 === 'number' ? pitchSegment.ground_area_m2 * 10.7639 : null,
          facet_source: solarHintCount > 0 ? 'vision_solar_guided' : 'vision',
        }
      })

    const solarGroundFootprintSqFt = solarGroundFootprintTotalSqFt(solarSegments)
    const { facets: facetsDeduped, dropped_note } = dedupeAndCapFacetFootprints(
      facetsMapped,
      validBounds,
      solarGroundFootprintSqFt,
      {
        solarGroundSumFactor: SUM_AREA_VS_SOLAR_GROUND_FACTOR_VISION,
        skipSolarFootprintCap: true,
      }
    )

    const facetsFiltered = validBounds
      ? facetsDeduped.filter((facet) => {
          const vs = facet.lat_lng_vertices
          if (!vs || vs.length === 0) return false
          const cLat = vs.reduce((s, p) => s + p.lat, 0) / vs.length
          const cLng = vs.reduce((s, p) => s + p.lng, 0) / vs.length
          return centroidInExpandedBounds(cLat, cLng, validBounds, 0.2)
        })
      : facetsDeduped

    const combinedNotes = [raw.notes || '', dropped_note || ''].filter(Boolean).join(' ')

    const normalizeLineGroup = (lines: RawLine[] | undefined, prefix: string) =>
      (lines || [])
        .filter((line) => isNearImageCenter(Array.isArray(line.points) ? line.points : []))
        .map((line, idx) => {
          const points = Array.isArray(line.points) ? line.points : []
          const latLngPoints = points.map(([x, y]) => pixelToGeoForVision(Number(x), Number(y)))
          return {
            id: line.id || `${prefix}_${idx + 1}`,
            points,
            lat_lng_points: latLngPoints,
            confidence: Number(line.confidence) || 0,
          }
        })

    const filterLines = (lines: ReturnType<typeof normalizeLineGroup>) =>
      validBounds ? lines.filter((line) => lineInBounds(line.lat_lng_points)) : lines

    const ridges = filterLines(normalizeLineGroup(raw.ridges, 'ridge'))
    const valleys = filterLines(normalizeLineGroup(raw.valleys, 'valley'))
    const stepFlashing = filterLines(normalizeLineGroup(raw.step_flashing, 'step_flash'))
    const wallFlashing = filterLines(normalizeLineGroup(raw.wall_flashing, 'wall_flash'))

    return NextResponse.json({
      facets: facetsFiltered,
      ridges,
      valleys,
      step_flashing: stepFlashing,
      wall_flashing: wallFlashing,
      notes: combinedNotes.trim(),
      solar_segments: solarSegments,
      solar_ground_footprint_sqft: solarGroundFootprintSqFt,
      requested_center: requestedCenter,
      capture_center: localizedCenter,
      capture_center_source: alignWithClientMap
        ? 'requested_center'
        : shouldUseSolarAnchor
          ? 'solar_anchor'
          : 'requested_center',
      detection_zoom: finalZoom,
      localization,
      facet_source: solarHintCount > 0 ? 'vision_solar_guided' : 'vision',
      detection_mode: 'vision',
      openai_calls: 2,
      solar_pixel_hints: solarHintCount,
      static_map_size: { width: visionW, height: visionH, logical: `${logicalSizeW}x${logicalSizeH}` },
    })
  } catch (error) {
    console.error('AI roof detect error:', error)
    const message = error instanceof Error ? error.message : 'Failed to detect roof'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
