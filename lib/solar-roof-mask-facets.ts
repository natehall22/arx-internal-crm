import { contours as d3contours } from 'd3-contour'
import * as geotiff from 'geotiff'
import geokeysToProj4 from 'geotiff-geokeys-to-proj4'
import proj4 from 'proj4'
import {
  fetchSolarDataLayerUrls,
  loadDsmHeightSampler,
  type DsmHeightSampler,
} from './solar-dsm'
import { ROOF_MEASURE_DSM_PLANE_SPLIT } from './roof-measure-flags'

export type SolarMaskSegment = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  area_m2: number | null
  ground_area_m2: number | null
  plane_height_at_center_meters: number | null
  center: { lat: number; lng: number } | null
  /** When present, limits Voronoi labeling so distant planes do not steal edge pixels. */
  bounding_box: {
    sw: { lat: number; lng: number }
    ne: { lat: number; lng: number }
  } | null
  /** Number of raw Solar fragments represented by this merged physical plane. */
  merged_segment_count?: number
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
  suggested_sloped_area_sqft: number | null
  plane_height_at_center_meters: number | null
  facet_source: string
}

const MAX_MASK_PIXELS = 4_000_000
/** Skip expensive per-pixel labeling above this (width×height×segments). */
const MAX_LABEL_OPS = 35_000_000
const MIN_RING_AREA_PX = 80
const MIN_SPLIT_RING_AREA_PX = 55
const MAX_FACETS = 6
const MAX_SEGMENTS_FOR_SPLIT = 22
const MAX_SPLIT_FACETS_OUTPUT = 16
/** Whole-roof / legacy multipolygon pick — keep UI light. */
const MAX_VERTICES_PER_RING = 48
/** Per-plane mask contours — more vertices follow hips and irregular eaves. */
const MAX_VERTICES_PER_SPLIT_RING = 72
/** Douglas–Peucker tolerance (mask px ≈ 0.1 m) to straighten split-plane contour edges. */
const SPLIT_RING_SIMPLIFY_EPS_PX = 4
/** Split plane contours below this footprint fail the mask-quality gate (bbox/whole fallback). */
const MIN_PLANE_FOOTPRINT_SQFT = 35

/** Structured reason when mask path does not return `solar_mask_plane` facets. */
export type SolarMaskFallbackReason =
  | 'ok'
  | 'no_mask_url'
  | 'geotiff_fetch_failed'
  | 'geotiff_parse_failed'
  | 'mask_too_large'
  | 'crs_unsupported'
  | 'no_roof_pixels'
  | 'no_segments_with_center'
  | 'label_budget_exceeded'
  | 'split_pin_miss'
  | 'split_quality_below_threshold'
  | 'whole_contour_pin_miss'
  | 'single_whole_multisegment'
  | 'unexpected_error'

export type SolarMaskAttemptResult = {
  facets: SolarMaskFacetPayload[] | null
  reason: SolarMaskFallbackReason
  /** Diagnostic fields for logs / detect-roof response (additive). */
  details?: Record<string, string | number | boolean | null>
}

function maskAttempt(
  reason: SolarMaskFallbackReason,
  facets: SolarMaskFacetPayload[] | null = null,
  details?: Record<string, string | number | boolean | null>
): SolarMaskAttemptResult {
  return { facets, reason, details }
}

type SegPx = {
  segment_index: number
  col: number
  row: number
  minC: number
  maxC: number
  minR: number
  maxR: number
  hasSpatialBounds: boolean
}

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

function perpDistancePx(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  const cx = a[0] + t * dx
  const cy = a[1] + t * dy
  return Math.hypot(p[0] - cx, p[1] - cy)
}

/** Douglas–Peucker on an open polyline (endpoints preserved). */
function douglasPeucker(pts: [number, number][], epsilon: number): [number, number][] {
  if (pts.length < 3) return pts
  let maxD = 0
  let idx = 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistancePx(pts[i], a, b)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > epsilon) {
    const left = douglasPeucker(pts.slice(0, idx + 1), epsilon)
    const right = douglasPeucker(pts.slice(idx), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

/**
 * Straighten a closed pixel ring: Douglas–Peucker removes the staircase jitter of a
 * mask contour so facet edges read as straight eaves/rakes, then cap the vertex count.
 * Falls back to even decimation if simplification collapses the ring.
 */
function simplifyClosedRing(
  ring: [number, number][],
  epsilonPx: number,
  maxVertices: number
): [number, number][] {
  const open = openRingPoints(ring)
  if (open.length < 4) return closeRing(open)
  const simplified = douglasPeucker([...open, open[0]], epsilonPx)
  const openSimplified = simplified.slice(0, -1)
  if (openSimplified.length < 3) return decimateClosedRing(ring, maxVertices)
  if (openSimplified.length > maxVertices) {
    return decimateClosedRing(closeRing(openSimplified), maxVertices)
  }
  return closeRing(openSimplified)
}

/** Monotonic-chain convex hull for regularizing a physical plane merged from fragments. */
function convexHullClosedRing(ring: [number, number][]): [number, number][] {
  const points = openRingPoints(ring)
    .map(([x, y]) => [x, y] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const unique = points.filter(
    (point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]
  )
  if (unique.length < 4) return closeRing(unique)
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: [number, number][] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const point = unique[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }
  return closeRing(lower.slice(0, -1).concat(upper.slice(0, -1)))
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

type SegmentRgbSample = { r: number; g: number; b: number }

/**
 * Detect a bright, neutral, low accessory plane surrounded by darker shingles.
 * This is deliberately conservative: geometry alone cannot distinguish the white
 * metal Helen Drive porch from the asphalt roof because Solar models both as roof.
 */
export function brightAccessorySegmentIndices(
  segments: SolarMaskSegment[],
  samples: Map<number, SegmentRgbSample>
): Set<number> {
  if (segments.length < 4 || samples.size < 4) return new Set()
  const sampleRows = segments.flatMap((segment) => {
    const rgb = samples.get(segment.segment_index)
    return rgb ? [{ segment, rgb, lightness: (rgb.r + rgb.g + rgb.b) / 3 }] : []
  })
  if (sampleRows.length < 4) return new Set()
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const medianLightness = median(sampleRows.map((row) => row.lightness))
  const pitches = segments.flatMap((segment) =>
    typeof segment.pitch_degrees === 'number' ? [segment.pitch_degrees] : []
  )
  const heights = segments.flatMap((segment) =>
    typeof segment.plane_height_at_center_meters === 'number'
      ? [segment.plane_height_at_center_meters]
      : []
  )
  if (pitches.length < 4 || heights.length < 4) return new Set()
  const medianPitch = median(pitches)
  const medianHeight = median(heights)

  return new Set(
    sampleRows
      .filter(({ segment, rgb, lightness }) => {
        const neutralRange = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
        return (
          lightness >= 235 &&
          lightness >= medianLightness + 40 &&
          neutralRange <= 18 &&
          typeof segment.pitch_degrees === 'number' &&
          segment.pitch_degrees <= medianPitch - 3 &&
          typeof segment.plane_height_at_center_meters === 'number' &&
          segment.plane_height_at_center_meters <= medianHeight - 0.3
        )
      })
      .map(({ segment }) => segment.segment_index)
  )
}

async function sampleSolarRgbAtSegmentCenters(options: {
  rgbUrl: string
  apiKey: string
  segments: SolarMaskSegment[]
  lngLatToColRow: MaskRasterAndProjector['lngLatToColRow']
  expectedWidth: number
  expectedHeight: number
}): Promise<Map<number, SegmentRgbSample>> {
  const { rgbUrl, apiKey, segments, lngLatToColRow, expectedWidth, expectedHeight } = options
  try {
    const response = await fetch(appendApiKeyToGeoTiffUrl(rgbUrl, apiKey))
    if (!response.ok) return new Map()
    const tiff = await geotiff.fromArrayBuffer(await response.arrayBuffer())
    const image = await tiff.getImage()
    if (image.getWidth() !== expectedWidth || image.getHeight() !== expectedHeight) return new Map()
    const rasters = await image.readRasters()
    if (!rasters[0] || !rasters[1] || !rasters[2]) return new Map()
    const samples = new Map<number, SegmentRgbSample>()
    for (const segment of segments) {
      if (!segment.center) continue
      const point = lngLatToColRow(segment.center.lat, segment.center.lng)
      if (!point) continue
      const cx = Math.round(point.col)
      const cy = Math.round(point.row)
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const col = cx + dx
          const row = cy + dy
          if (col < 0 || row < 0 || col >= expectedWidth || row >= expectedHeight) continue
          const i = row * expectedWidth + col
          r += Number(rasters[0][i])
          g += Number(rasters[1][i])
          b += Number(rasters[2][i])
          count++
        }
      }
      if (count > 0) samples.set(segment.segment_index, { r: r / count, g: g / count, b: b / count })
    }
    return samples
  } catch (error) {
    console.warn('[solar-mask] RGB accessory sampling failed:', error)
    return new Map()
  }
}

type MaskRasterLoadResult =
  | { ok: true; data: MaskRasterAndProjector }
  | { ok: false; reason: SolarMaskFallbackReason; details?: Record<string, string | number | boolean | null> }

async function loadMaskRasterAndProjector(
  maskUrl: string,
  apiKey: string
): Promise<MaskRasterLoadResult> {
  const fetchUrl = appendApiKeyToGeoTiffUrl(maskUrl, apiKey)
  const response = await fetch(fetchUrl)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn('[solar-mask] GeoTIFF fetch failed:', response.status, detail.slice(0, 200))
    return {
      ok: false,
      reason: 'geotiff_fetch_failed',
      details: { http_status: response.status },
    }
  }
  const arrayBuffer = await response.arrayBuffer()
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  if (width * height > MAX_MASK_PIXELS) {
    console.warn('[solar-mask] mask too large:', width, height)
    return {
      ok: false,
      reason: 'mask_too_large',
      details: { mask_width: width, mask_height: height },
    }
  }

  const geoKeys = image.getGeoKeys()
  if (!geoKeys) {
    console.warn('[solar-mask] GeoTIFF missing geokeys')
    return { ok: false, reason: 'geotiff_parse_failed', details: { stage: 'missing_geokeys' } }
  }

  let projObj: ReturnType<typeof geokeysToProj4.toProj4>
  try {
    projObj = geokeysToProj4.toProj4(geoKeys as Parameters<typeof geokeysToProj4.toProj4>[0])
  } catch (e) {
    console.warn('[solar-mask] geokeysToProj4 failed:', e)
    return { ok: false, reason: 'geotiff_parse_failed', details: { stage: 'geokeys_to_proj4' } }
  }
  if (projObj.errors?.CRSNotSupported != null) {
    console.warn('[solar-mask] CRS not supported for mask GeoTIFF')
    return { ok: false, reason: 'crs_unsupported' }
  }

  const toWgs84 = proj4(projObj.proj4, '+proj=longlat +datum=WGS84 +no_defs')
  const fromWgs84 = proj4('+proj=longlat +datum=WGS84 +no_defs', projObj.proj4)
  const conv = projObj.coordinatesConversionParameters
  const [ox, oy] = image.getOrigin()
  const [rawRx, rawRy] = image.getResolution()
  // Google Solar tiles are north-up UTM (origin = NW corner), but geotiff.js
  // getResolution() has been observed to return a POSITIVE row step for these
  // masks (e.g. 4101 Woodbury Terrace NW / Concord). Used raw, that flips the
  // vertical axis so the pin projects outside the raster and every mask facet
  // lands ~100–300 m off the house. Normalize to the north-up convention:
  // east-positive columns, north-decreasing (negative) rows.
  const rx = Math.abs(rawRx)
  const ry = -Math.abs(rawRy)

  const pixelToLngLat = (col: number, row: number) => {
    const gx = ox + col * rx
    const gy = oy + row * ry
    const c = geokeysToProj4.convertCoordinates(gx, gy, 0, conv)
    const projected = toWgs84.forward([c.x, c.y])
    const lng = projected[0]
    const lat = projected[1]
    return { lat, lng }
  }

  /** Match `lib/solar-dsm.ts` WGS84→raster path so segment centers align with mask pixels. */
  const lngLatToColRow = (lat: number, lng: number): { col: number; row: number } | null => {
    try {
      const projected = fromWgs84.forward([lng, lat])
      const c = geokeysToProj4.convertCoordinates(projected[0], projected[1], 0, conv)
      const col = (c.x - ox) / rx
      const row = (c.y - oy) / ry
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
    return { ok: false, reason: 'geotiff_parse_failed', details: { stage: 'read_rasters' } }
  }

  return {
    ok: true,
    data: { band0, width, height, pixelToLngLat, lngLatToColRow },
  }
}

function pointInPolygonLngLat(pt: { lat: number; lng: number }, ring: { lat: number; lng: number }[]): boolean {
  if (ring.length < 3) return false
  const py = pt.lat
  const px = pt.lng
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
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

function segmentByIndex(segments: SolarMaskSegment[], idx: number): SolarMaskSegment | null {
  return segments.find((s) => s.segment_index === idx) ?? null
}

/** Pitch/azimuth/ground-area suggestions from a Solar segment (null when segment missing). */
export function segmentFacetSuggestions(seg: SolarMaskSegment | null): Pick<
  SolarMaskFacetPayload,
  | 'suggested_pitch_degrees'
  | 'suggested_azimuth_degrees'
  | 'suggested_ground_area_sqft'
  | 'suggested_sloped_area_sqft'
  | 'plane_height_at_center_meters'
> {
  if (!seg) {
    return {
      suggested_pitch_degrees: null,
      suggested_azimuth_degrees: null,
      suggested_ground_area_sqft: null,
      suggested_sloped_area_sqft: null,
      plane_height_at_center_meters: null,
    }
  }
  return {
    suggested_pitch_degrees: seg.pitch_degrees,
    suggested_azimuth_degrees: seg.azimuth_degrees,
    suggested_ground_area_sqft:
      typeof seg.ground_area_m2 === 'number' ? seg.ground_area_m2 * 10.7639 : null,
    suggested_sloped_area_sqft:
      typeof seg.area_m2 === 'number' ? seg.area_m2 * 10.7639 : null,
    plane_height_at_center_meters: seg.plane_height_at_center_meters,
  }
}

/**
 * Suggestions for a mask contour. A merged physical plane may contain overlapping
 * Solar fragments, so their summed API areas do not describe the resulting contour.
 * In that case the UI must use contour footprint × pitch instead.
 */
export function maskPlaneFacetSuggestions(seg: SolarMaskSegment | null): ReturnType<typeof segmentFacetSuggestions> {
  const suggestions = segmentFacetSuggestions(seg)
  if ((seg?.merged_segment_count ?? 1) <= 1) return suggestions
  return {
    ...suggestions,
    suggested_ground_area_sqft: null,
    suggested_sloped_area_sqft: null,
  }
}

/**
 * Prefer `solar_mask_plane` over `solar_bbox` / whole-roof contour when split facets pass this gate.
 */
export function splitFacetsMeetMaskQualityThreshold(facets: SolarMaskFacetPayload[]): boolean {
  const planes = facets.filter((f) => f.facet_source === 'solar_mask_plane')
  if (planes.length === 0) return false
  return planes.some((f) => {
    if (f.lat_lng_vertices.length < 3) return false
    const sqft = f.estimated_sq_ft ?? Math.round(planarPolygonAreaSqFt(f.lat_lng_vertices))
    return sqft >= MIN_PLANE_FOOTPRINT_SQFT
  })
}

function buildSegmentPxList(
  segments: SolarMaskSegment[],
  lngLatToColRow: (lat: number, lng: number) => { col: number; row: number } | null
): SegPx[] {
  const out: SegPx[] = []
  const pad = 4
  for (const s of segments) {
    if (!s.center) continue
    const c0 = lngLatToColRow(s.center.lat, s.center.lng)
    if (!c0) continue
    let minC = c0.col - 8
    let maxC = c0.col + 8
    let minR = c0.row - 8
    let maxR = c0.row + 8
    let hasSpatialBounds = false
    if (s.bounding_box) {
      const { ne, sw } = s.bounding_box
      const pts = [
        lngLatToColRow(ne.lat, sw.lng),
        lngLatToColRow(ne.lat, ne.lng),
        lngLatToColRow(sw.lat, ne.lng),
        lngLatToColRow(sw.lat, sw.lng),
      ].filter((p): p is { col: number; row: number } => Boolean(p))
      if (pts.length >= 2) {
        const cs = pts.map((p) => p.col)
        const rs = pts.map((p) => p.row)
        minC = Math.min(...cs) - pad
        maxC = Math.max(...cs) + pad
        minR = Math.min(...rs) - pad
        maxR = Math.max(...rs) + pad
        hasSpatialBounds = true
      }
    }
    out.push({
      segment_index: s.segment_index,
      col: c0.col,
      row: c0.row,
      minC,
      maxC,
      minR,
      maxR,
      hasSpatialBounds,
    })
  }
  return out
}

/**
 * Solar's roof mask can omit valid low-contrast roof pixels. Expand the DSM candidate
 * area to the supplied segment footprints; plane-height matching later rejects ground,
 * lower porches, and other pixels that do not belong to a known roof plane.
 */
function expandMaskToSegmentBounds(
  mask: Uint8Array,
  width: number,
  height: number,
  segments: SegPx[]
): Uint8Array {
  const expanded = mask.slice()
  for (const segment of segments) {
    if (!segment.hasSpatialBounds) continue
    const minC = Math.max(0, Math.floor(segment.minC))
    const maxC = Math.min(width - 1, Math.ceil(segment.maxC))
    const minR = Math.max(0, Math.floor(segment.minR))
    const maxR = Math.min(height - 1, Math.ceil(segment.maxR))
    for (let row = minR; row <= maxR; row++) {
      for (let col = minC; col <= maxC; col++) expanded[row * width + col] = 1
    }
  }
  return expanded
}

function removeSegmentBoundsFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  segments: SegPx[]
): Uint8Array {
  const trimmed = mask.slice()
  for (const segment of segments) {
    if (!segment.hasSpatialBounds) continue
    const minC = Math.max(0, Math.floor(segment.minC))
    const maxC = Math.min(width - 1, Math.ceil(segment.maxC))
    const minR = Math.max(0, Math.floor(segment.minR))
    const maxR = Math.min(height - 1, Math.ceil(segment.maxR))
    for (let row = minR; row <= maxR; row++) {
      for (let col = minC; col <= maxC; col++) trimmed[row * width + col] = 0
    }
  }
  return trimmed
}

/**
 * Restrict a binary roof mask to the connected component(s) reachable from the
 * target building's Solar segment centers. Solar mask tiles cover a ~200 m
 * radius and include neighboring houses; without this, the Voronoi labeling
 * below assigns whole neighbor roofs to the target segments and the split
 * collapses into a few giant multi-house blobs (observed on 4101 Woodbury
 * Terrace NW: one segment vacuumed 205k of 399k roof pixels). 8-connected flood
 * fill from the segment centers keeps only this house's roof pixels. Returns
 * null when no seed lands on/near a roof pixel so callers fall back to the full
 * mask rather than dropping everything.
 */
export function restrictMaskToSeedComponent(
  bin: Uint8Array,
  width: number,
  height: number,
  seeds: Array<{ col: number; row: number }>,
  snapRadiusPx = 6
): Uint8Array | null {
  const snap = (col: number, row: number): number | null => {
    const c0 = Math.round(col)
    const r0 = Math.round(row)
    for (let r = 0; r <= snapRadiusPx; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          const c = c0 + dc
          const rw = r0 + dr
          if (c >= 0 && c < width && rw >= 0 && rw < height && bin[rw * width + c] === 1) {
            return rw * width + c
          }
        }
      }
    }
    return null
  }

  const target = new Uint8Array(width * height)
  const stack: number[] = []
  for (const s of seeds) {
    const i = snap(s.col, s.row)
    if (i != null && target[i] === 0) {
      target[i] = 1
      stack.push(i)
    }
  }
  if (stack.length === 0) return null

  while (stack.length > 0) {
    const i = stack.pop() as number
    const col = i % width
    const row = (i / width) | 0
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue
        const c = col + dc
        const rw = row + dr
        if (c < 0 || c >= width || rw < 0 || rw >= height) continue
        const j = rw * width + c
        if (bin[j] === 1 && target[j] === 0) {
          target[j] = 1
          stack.push(j)
        }
      }
    }
  }
  return target
}

/** Assign each roof-mask pixel to the nearest Solar segment center (Voronoi on-mask). */
function labelRoofMaskBySegments(
  bin: Uint8Array,
  width: number,
  height: number,
  segsPx: SegPx[]
): Int32Array {
  const labels = new Int32Array(width * height)
  labels.fill(-1)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (bin[i] === 0) continue
      let bestIdx = -1
      let bestD = Infinity
      const candidates: SegPx[] = []
      for (const s of segsPx) {
        if (col >= s.minC && col <= s.maxC && row >= s.minR && row <= s.maxR) candidates.push(s)
      }
      const pool = candidates.length > 0 ? candidates : segsPx
      for (const s of pool) {
        const dc = col - s.col
        const dr = row - s.row
        const d = dc * dc + dr * dr
        if (d < bestD) {
          bestD = d
          bestIdx = s.segment_index
        }
      }
      labels[i] = bestIdx
    }
  }
  return labels
}

const M_PER_DEG_LAT = 111320
const COPLANAR_AZIMUTH_TOLERANCE_DEG = 25
const COPLANAR_PITCH_TOLERANCE_DEG = 8
const COPLANAR_HEIGHT_TOLERANCE_M = 1
/** Reject connected mask pixels that are not close to any known Solar plane (for example, a low porch). */
const MAX_DSM_PLANE_HEIGHT_ERROR_M = Number(
  process.env.ROOF_MEASURE_DSM_MAX_PLANE_ERROR_M ?? '1.5'
)
const MAX_MASK_PLANE_HEIGHT_ERROR_M = 3

type MaskPlane = {
  segment_index: number
  /** Unit normal, z-up (nz = cos pitch > 0). */
  nx: number
  ny: number
  nz: number
  /** Plane reference point in local ENU meters: segment center (x,y) at planeHeight (z, MSL). */
  cx: number
  cy: number
  cz: number
}

/** Solar planes in a local ENU frame for DSM-elevation matching (needs pitch, azimuth, height, center). */
function buildMaskPlanes(
  segments: SolarMaskSegment[],
  origin: { lat: number; lng: number }
): MaskPlane[] {
  const mLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)
  const out: MaskPlane[] = []
  for (const s of segments) {
    const pitch = s.pitch_degrees
    const az = s.azimuth_degrees
    const h = s.plane_height_at_center_meters
    if (
      s.center == null ||
      pitch == null ||
      az == null ||
      h == null ||
      !Number.isFinite(pitch) ||
      !Number.isFinite(az) ||
      !Number.isFinite(h)
    ) {
      continue
    }
    const p = (pitch * Math.PI) / 180
    const a = (az * Math.PI) / 180
    out.push({
      segment_index: s.segment_index,
      nx: Math.sin(p) * Math.sin(a),
      ny: Math.sin(p) * Math.cos(a),
      nz: Math.cos(p),
      cx: (s.center.lng - origin.lng) * mLng,
      cy: (s.center.lat - origin.lat) * M_PER_DEG_LAT,
      cz: h,
    })
  }
  return out
}

/** Elevation this plane predicts at local (x, y) meters. Moving downslope (azimuth dir) lowers z. */
function planePredictedHeight(pl: MaskPlane, x: number, y: number): number {
  return pl.cz - (pl.nx * (x - pl.cx) + pl.ny * (y - pl.cy)) / pl.nz
}

function circularDegreesDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

/**
 * Merge Solar fragments that describe the same physical roof plane. Solar sometimes
 * subdivides a simple face into several near-identical segments (observed at 276
 * Epworth), which otherwise produces blocky internal seams. Direction/pitch alone is
 * insufficient because dormers may be parallel, so both plane equations must also
 * predict the other segment center's elevation within a tight tolerance.
 */
export function mergeCoplanarSolarSegments(
  segments: SolarMaskSegment[],
  origin: { lat: number; lng: number }
): SolarMaskSegment[] {
  const eligible = segments.filter(
    (s) =>
      s.center &&
      Number.isFinite(s.pitch_degrees) &&
      Number.isFinite(s.azimuth_degrees) &&
      Number.isFinite(s.plane_height_at_center_meters)
  )
  if (eligible.length < 2) return segments

  const planes = buildMaskPlanes(eligible, origin)
  const planeByIndex = new Map(planes.map((p) => [p.segment_index, p]))
  const parent = new Map(eligible.map((s) => [s.segment_index, s.segment_index]))
  const find = (index: number): number => {
    let root = parent.get(index) ?? index
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) as number
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb))
  }

  for (let i = 0; i < eligible.length; i++) {
    const a = eligible[i]
    const pa = planeByIndex.get(a.segment_index)
    if (!pa || !a.center) continue
    for (let j = i + 1; j < eligible.length; j++) {
      const b = eligible[j]
      const pb = planeByIndex.get(b.segment_index)
      if (!pb || !b.center) continue
      if (
        circularDegreesDifference(a.azimuth_degrees as number, b.azimuth_degrees as number) >
          COPLANAR_AZIMUTH_TOLERANCE_DEG ||
        Math.abs((a.pitch_degrees as number) - (b.pitch_degrees as number)) >
          COPLANAR_PITCH_TOLERANCE_DEG
      ) {
        continue
      }
      const errAAtB = Math.abs(planePredictedHeight(pa, pb.cx, pb.cy) - pb.cz)
      const errBAtA = Math.abs(planePredictedHeight(pb, pa.cx, pa.cy) - pa.cz)
      if (Math.max(errAAtB, errBAtA) <= COPLANAR_HEIGHT_TOLERANCE_M) {
        union(a.segment_index, b.segment_index)
      }
    }
  }

  const groups = new Map<number, SolarMaskSegment[]>()
  for (const segment of segments) {
    const root = parent.has(segment.segment_index) ? find(segment.segment_index) : segment.segment_index
    const group = groups.get(root) ?? []
    group.push(segment)
    groups.set(root, group)
  }

  return Array.from(groups.values()).map((group) => {
    if (group.length === 1) return group[0]
    const weightOf = (s: SolarMaskSegment) => Math.max(s.ground_area_m2 ?? s.area_m2 ?? 1, 0.01)
    const totalWeight = group.reduce((sum, s) => sum + weightOf(s), 0)
    const weighted = (value: (s: SolarMaskSegment) => number | null): number | null => {
      const present = group.filter((s) => value(s) != null)
      if (present.length === 0) return null
      const weight = present.reduce((sum, s) => sum + weightOf(s), 0)
      return present.reduce((sum, s) => sum + (value(s) as number) * weightOf(s), 0) / weight
    }
    const azX = group.reduce(
      (sum, s) => sum + Math.cos(((s.azimuth_degrees ?? 0) * Math.PI) / 180) * weightOf(s),
      0
    )
    const azY = group.reduce(
      (sum, s) => sum + Math.sin(((s.azimuth_degrees ?? 0) * Math.PI) / 180) * weightOf(s),
      0
    )
    const representative = [...group].sort((a, b) => a.segment_index - b.segment_index)[0]
    const boxes = group
      .map((s) => s.bounding_box)
      .filter((box): box is NonNullable<SolarMaskSegment['bounding_box']> => Boolean(box))
    return {
      ...representative,
      merged_segment_count: group.length,
      pitch_degrees: weighted((s) => s.pitch_degrees),
      azimuth_degrees: (Math.atan2(azY, azX) * 180) / Math.PI + (azY < 0 ? 360 : 0),
      area_m2: group.reduce((sum, s) => sum + (s.area_m2 ?? 0), 0),
      ground_area_m2: group.reduce((sum, s) => sum + (s.ground_area_m2 ?? 0), 0),
      plane_height_at_center_meters: weighted((s) => s.plane_height_at_center_meters),
      center: {
        lat: group.reduce((sum, s) => sum + (s.center?.lat ?? origin.lat) * weightOf(s), 0) / totalWeight,
        lng: group.reduce((sum, s) => sum + (s.center?.lng ?? origin.lng) * weightOf(s), 0) / totalWeight,
      },
      bounding_box:
        boxes.length > 0
          ? {
              sw: {
                lat: Math.min(...boxes.map((box) => box.sw.lat)),
                lng: Math.min(...boxes.map((box) => box.sw.lng)),
              },
              ne: {
                lat: Math.max(...boxes.map((box) => box.ne.lat)),
                lng: Math.max(...boxes.map((box) => box.ne.lng)),
              },
            }
          : null,
    }
  })
}

/**
 * Smooth a per-pixel label field with a bounded majority (mode) filter — removes
 * DSM speckle so plane regions contour cleanly. Only target-mask pixels vote.
 */
function majorityFilterLabels(
  labels: Int32Array,
  mask: Uint8Array,
  width: number,
  height: number,
  bbox: { minC: number; maxC: number; minR: number; maxR: number },
  passes: number,
  radius: number
): void {
  const { minC, maxC, minR, maxR } = bbox
  for (let pass = 0; pass < passes; pass++) {
    const prev = labels.slice()
    for (let row = minR; row <= maxR; row++) {
      for (let col = minC; col <= maxC; col++) {
        const i = row * width + col
        if (mask[i] !== 1 || prev[i] < 0) continue
        const counts = new Map<number, number>()
        for (let dr = -radius; dr <= radius; dr++) {
          const rr = row + dr
          if (rr < 0 || rr >= height) continue
          for (let dc = -radius; dc <= radius; dc++) {
            const cc = col + dc
            if (cc < 0 || cc >= width) continue
            const j = rr * width + cc
            if (mask[j] !== 1) continue
            const v = prev[j]
            if (v < 0) continue
            counts.set(v, (counts.get(v) ?? 0) + 1)
          }
        }
        let bestV = prev[i]
        let bestN = -1
        counts.forEach((n, k) => {
          if (n > bestN) {
            bestN = n
            bestV = k
          }
        })
        labels[i] = bestV
      }
    }
  }
}

/**
 * Label each target roof pixel by the Solar plane whose predicted elevation best
 * matches the DSM there, so facet boundaries fall on real ridges/hips/valleys (where
 * two planes' heights cross) instead of nearest-center Voronoi bisectors. Pixels with
 * no DSM sample fall back to the nearest segment center; the field is majority-filtered
 * before contouring. Labels use `segment_index` values, matching `labelRoofMaskBySegments`.
 */
function labelRoofMaskByPlanes(options: {
  workBin: Uint8Array
  /** Original connected roof mask; bbox-expanded pixels require a real DSM match. */
  fallbackBin: Uint8Array
  width: number
  height: number
  planes: MaskPlane[]
  origin: { lat: number; lng: number }
  pixelToLngLat: (col: number, row: number) => { lat: number; lng: number }
  sampleDsm: DsmHeightSampler
  segsPx: SegPx[]
  /** Simple gables should retain every pixel in the connected satellite mask. */
  preserveOriginalMaskCoverage?: boolean
}): Int32Array {
  const {
    workBin,
    fallbackBin,
    width,
    height,
    planes,
    origin,
    pixelToLngLat,
    sampleDsm,
    segsPx,
    preserveOriginalMaskCoverage = false,
  } = options
  const labels = new Int32Array(width * height).fill(-1)
  if (planes.length === 0) return labels

  const mLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)
  // Solar plane heights and the DSM can have a small vertical-datum offset. Anchor
  // each plane to the DSM at its own center before comparing surrounding pixels.
  const planeHeightOffsets = new Map<number, number>()
  for (const plane of planes) {
    const centerLat = origin.lat + plane.cy / M_PER_DEG_LAT
    const centerLng = origin.lng + plane.cx / mLng
    const centerDsm = sampleDsm(centerLat, centerLng)
    planeHeightOffsets.set(
      plane.segment_index,
      centerDsm != null && Number.isFinite(centerDsm) ? centerDsm - plane.cz : 0
    )
  }

  let minC = width
  let maxC = -1
  let minR = height
  let maxR = -1
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (workBin[row * width + col] !== 1) continue
      if (col < minC) minC = col
      if (col > maxC) maxC = col
      if (row < minR) minR = row
      if (row > maxR) maxR = row
    }
  }
  if (maxC < minC) return labels

  const nearestSegmentLabel = (col: number, row: number): number => {
    let best = -1
    let bd = Infinity
    for (const s of segsPx) {
      const dc = col - s.col
      const dr = row - s.row
      const d = dc * dc + dr * dr
      if (d < bd) {
        bd = d
        best = s.segment_index
      }
    }
    return best
  }

  for (let row = minR; row <= maxR; row++) {
    for (let col = minC; col <= maxC; col++) {
      const i = row * width + col
      if (workBin[i] !== 1) continue
      const { lat, lng } = pixelToLngLat(col, row)
      const dz = sampleDsm(lat, lng)
      if (dz == null || !Number.isFinite(dz)) {
        if (fallbackBin[i] === 1) labels[i] = nearestSegmentLabel(col, row)
        continue
      }
      const x = (lng - origin.lng) * mLng
      const y = (lat - origin.lat) * M_PER_DEG_LAT
      let best = -1
      let bd = Infinity
      for (const pl of planes) {
        const predicted =
          planePredictedHeight(pl, x, y) + (planeHeightOffsets.get(pl.segment_index) ?? 0)
        const err = Math.abs(dz - predicted)
        if (err < bd) {
          bd = err
          best = pl.segment_index
        }
      }
      const maxError =
        fallbackBin[i] === 1
          ? preserveOriginalMaskCoverage
            ? Infinity
            : MAX_MASK_PLANE_HEIGHT_ERROR_M
          : MAX_DSM_PLANE_HEIGHT_ERROR_M
      if (bd <= maxError) labels[i] = best
    }
  }

  majorityFilterLabels(labels, workBin, width, height, { minC, maxC, minR, maxR }, 3, 2)
  return labels
}

function largestRing(rings: [number, number][][]): [number, number][] | null {
  let best: [number, number][] | null = null
  let bestA = 0
  for (const r of rings) {
    const a = polygonAreaPx(r)
    if (a > bestA) {
      bestA = a
      best = r
    }
  }
  return best
}

function facetsFromSplitMask(options: {
  bin: Uint8Array
  labels: Int32Array
  width: number
  height: number
  segsPx: SegPx[]
  segments: SolarMaskSegment[]
  pixelToLngLat: (col: number, row: number) => { lat: number; lng: number }
}): SolarMaskFacetPayload[] {
  const { bin, labels, width, height, segsPx, segments, pixelToLngLat } = options
  const scratch = new Float64Array(width * height)
  const out: SolarMaskFacetPayload[] = []

  const ordered = [...segsPx].sort((a, b) => a.segment_index - b.segment_index)
  for (const meta of ordered) {
    scratch.fill(0)
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === meta.segment_index && bin[i] === 1) scratch[i] = 1
    }
    const rings = contourRingsFromMask(scratch, width, height, { smooth: false }).filter(
      (r) => polygonAreaPx(r) >= MIN_SPLIT_RING_AREA_PX
    )
    const ring = largestRing(rings)
    if (!ring) continue

    const seg = segmentByIndex(segments, meta.segment_index)
    const regularizePrimaryPlane =
      (seg?.merged_segment_count ?? 1) > 1 || (seg?.ground_area_m2 ?? 0) >= 40
    const regularizedRing = regularizePrimaryPlane ? convexHullClosedRing(ring) : ring
    const simplified = simplifyClosedRing(
      regularizedRing,
      SPLIT_RING_SIMPLIFY_EPS_PX,
      MAX_VERTICES_PER_SPLIT_RING
    )
    if (simplified.length < 4) continue

    const latLngVertices: { lat: number; lng: number }[] = []
    for (let i = 0; i < simplified.length - 1; i++) {
      const [x, y] = simplified[i]
      latLngVertices.push(pixelToLngLat(x, y))
    }
    if (latLngVertices.length < 3) continue

    const estSqFt = Math.round(planarPolygonAreaSqFt(latLngVertices))

    out.push({
      id: `solar_mask_plane_${meta.segment_index}`,
      vertices: [],
      lat_lng_vertices: latLngVertices,
      confidence: 0.9,
      estimated_sq_ft: estSqFt > 0 ? estSqFt : null,
      solar_segment_index: meta.segment_index,
      ...maskPlaneFacetSuggestions(seg),
      facet_source: 'solar_mask_plane',
    })
  }

  return out
}

const PIN_MATCH_MAX_METERS = 24
/** Whole-roof contour: geocode pin can sit on driveway; allow farther ring match. */
const WHOLE_CONTOUR_PIN_MAX_METERS = 85
const HOUSE_CLUSTER_MAX_METERS = 22

function solarStructureReference(
  segments: SolarMaskSegment[],
  fallback: { lat: number; lng: number }
): { lat: number; lng: number } {
  const centers = segments
    .map((s) => s.center)
    .filter((c): c is { lat: number; lng: number } => Boolean(c))
  if (centers.length === 0) return fallback
  return centers.reduce(
    (acc, c) => ({
      lat: acc.lat + c.lat / centers.length,
      lng: acc.lng + c.lng / centers.length,
    }),
    { lat: 0, lng: 0 }
  )
}

/** When Voronoi label ops exceed budget, label only the largest planes (by ground area). */
function segmentsForMaskLabeling(
  segments: SolarMaskSegment[],
  width: number,
  height: number
): SolarMaskSegment[] {
  const withCenter = segments.filter((s) => s.center)
  if (withCenter.length === 0) return []
  const sorted = [...withCenter].sort(
    (a, b) => (b.ground_area_m2 ?? b.area_m2 ?? 0) - (a.ground_area_m2 ?? a.area_m2 ?? 0)
  )
  let n = Math.min(sorted.length, MAX_SEGMENTS_FOR_SPLIT)
  while (n > 1 && width * height * n > MAX_LABEL_OPS) n--
  return sorted.slice(0, n)
}

/** Keep only facets that plausibly belong to the user’s pin; otherwise fail closed. */
export function filterSplitFacetsByPin(
  facets: SolarMaskFacetPayload[],
  ref: { lat: number; lng: number }
): SolarMaskFacetPayload[] {
  if (facets.length === 0) return facets
  const scored = facets.map((f) => {
    const vs = f.lat_lng_vertices
    const cLat = vs.reduce((s, p) => s + p.lat, 0) / vs.length
    const cLng = vs.reduce((s, p) => s + p.lng, 0) / vs.length
    const inside = pointInPolygonLngLat(ref, vs)
    const dist = distanceMeters(ref, { lat: cLat, lng: cLng })
    return { f, inside, dist, area: planarPolygonAreaSqFt(vs), centroid: { lat: cLat, lng: cLng } }
  })

  const primary =
    scored
      .filter((x) => x.inside || x.dist <= PIN_MATCH_MAX_METERS)
      .sort((a, b) => {
        if (a.inside !== b.inside) return a.inside ? -1 : 1
        return a.dist - b.dist
      })[0] ?? null

  if (!primary) return []

  const pool = scored.filter((x) => {
    if (x.inside || x.dist <= PIN_MATCH_MAX_METERS) return true
    return distanceMeters(x.centroid, primary.centroid) <= HOUSE_CLUSTER_MAX_METERS
  })

  return pool
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_SPLIT_FACETS_OUTPUT)
    .map((x) => x.f)
}

/** Exported for unit tests — converts a roof-mask raster band to pixel-space rings (column, row). */
export function contourRingsFromMask(
  band: geotiff.TypedArray,
  width: number,
  height: number,
  options?: { smooth?: boolean }
): [number, number][][] {
  const values = new Float64Array(width * height)
  for (let i = 0; i < values.length; i++) {
    const v = band[i]
    values[i] = v !== 0 && Number(v) > 0 ? 1 : 0
  }

  if (width < 2 || height < 2) return []

  const smooth = options?.smooth !== false
  const generator = d3contours().size([width, height]).thresholds([0.5]).smooth(smooth)
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
 * Returns structured `reason` when mask planes are unavailable (bbox fallback in detect-roof).
 */
export async function tryFacetPayloadsFromSolarRoofMask(options: {
  lat: number
  lng: number
  apiKey: string
  referenceLat: number
  referenceLng: number
  segments: SolarMaskSegment[]
  /** Optional label for diagnostics (e.g. requested_pin vs solar_anchor). */
  querySource?: string
}): Promise<SolarMaskAttemptResult> {
  const { lat, lng, apiKey, referenceLat, referenceLng, segments, querySource } = options
  const baseDetails = {
    query_lat: lat,
    query_lng: lng,
    reference_lat: referenceLat,
    reference_lng: referenceLng,
    segment_count: segments.length,
    query_source: querySource ?? 'unspecified',
  }

  try {
    const { maskUrl, dsmUrl, rgbUrl } = await fetchSolarDataLayerUrls(lat, lng, apiKey)
    if (!maskUrl) {
      return maskAttempt('no_mask_url', null, baseDetails)
    }

    const loaded = await loadMaskRasterAndProjector(maskUrl, apiKey)
    if (!loaded.ok) {
      return maskAttempt(loaded.reason, null, { ...baseDetails, ...loaded.details })
    }

    const { band0, width, height, pixelToLngLat, lngLatToColRow } = loaded.data

    const bin = new Uint8Array(width * height)
    for (let i = 0; i < band0.length; i++) {
      const v = band0[i]
      bin[i] = v !== 0 && Number(v) > 0 ? 1 : 0
    }

    const roofPixelCount = bin.reduce((s, v) => s + (v === 1 ? 1 : 0), 0)
    if (roofPixelCount === 0) {
      return maskAttempt('no_roof_pixels', null, {
        ...baseDetails,
        mask_width: width,
        mask_height: height,
      })
    }

    // Keep only this building's roof pixels before labeling/contouring so the
    // ~200 m tile's neighboring houses cannot bleed into the split or the
    // whole-roof contour. Seed from every segment center; fall back to the full
    // mask if the flood fill finds nothing (e.g. all centers off-roof).
    const componentSeeds = segments
      .map((s) => (s.center ? lngLatToColRow(s.center.lat, s.center.lng) : null))
      .filter((p): p is { col: number; row: number } => Boolean(p))
    const targetComponent =
      componentSeeds.length > 0
        ? restrictMaskToSeedComponent(bin, width, height, componentSeeds)
        : null
    let workBin = targetComponent ?? bin

    const rgbSamples = rgbUrl
      ? await sampleSolarRgbAtSegmentCenters({
          rgbUrl,
          apiKey,
          segments,
          lngLatToColRow,
          expectedWidth: width,
          expectedHeight: height,
        })
      : new Map<number, SegmentRgbSample>()
    const excludedAccessoryIndices = brightAccessorySegmentIndices(segments, rgbSamples)
    const activeSegments = segments.filter(
      (segment) => !excludedAccessoryIndices.has(segment.segment_index)
    )
    if (excludedAccessoryIndices.size > 0) {
      const excludedPx = buildSegmentPxList(
        segments.filter((segment) => excludedAccessoryIndices.has(segment.segment_index)),
        lngLatToColRow
      )
      workBin = removeSegmentBoundsFromMask(workBin, width, height, excludedPx)
    }

    const pinRef = { lat: referenceLat, lng: referenceLng }
    const structureRef = solarStructureReference(activeSegments, pinRef)
    const mergedSegments = mergeCoplanarSolarSegments(activeSegments, structureRef)
    const labelSegments = segmentsForMaskLabeling(mergedSegments, width, height)
    const segsPx = buildSegmentPxList(labelSegments, lngLatToColRow)

    const ref = structureRef
    const refPx = lngLatToColRow(ref.lat, ref.lng)

    const labelBudget = width * height * Math.max(1, segsPx.length)
    if (segsPx.length === 0) {
      // Fall through to whole-roof contour below.
    } else if (labelBudget > MAX_LABEL_OPS) {
      console.info('[solar-mask] label budget exceeded after segment cap; whole-roof contour', {
        labelBudget,
        label_segment_count: labelSegments.length,
        raw_segment_count: segments.length,
        ...baseDetails,
      })
    } else if (workBin.some((v) => v === 1)) {
      // DSM-plane labeling (ridge-following) when available; else nearest-center Voronoi.
      let splitMethod: 'dsm_plane' | 'voronoi' = 'voronoi'
      const planes = ROOF_MEASURE_DSM_PLANE_SPLIT
        ? buildMaskPlanes(labelSegments, structureRef)
        : []
      const dsmSampler =
        ROOF_MEASURE_DSM_PLANE_SPLIT && dsmUrl && planes.length >= 2
          ? await loadDsmHeightSampler(dsmUrl, apiKey)
          : null
      let labels: Int32Array
      let splitBin = workBin
      if (dsmSampler && planes.length >= 2) {
        // A clean two-plane gable already has the right outer satellite mask. Expanding
        // and height-clipping it can shrink valid eaves. Complex roofs need the expanded
        // Solar footprints so elevated dormers survive while low porch roofs are rejected.
        const preserveSimpleGable = planes.length === 2 && labelSegments.length === 2
        splitBin = preserveSimpleGable
          ? workBin
          : expandMaskToSegmentBounds(workBin, width, height, segsPx)
        labels = labelRoofMaskByPlanes({
          workBin: splitBin,
          fallbackBin: workBin,
          width,
          height,
          planes,
          origin: structureRef,
          pixelToLngLat,
          sampleDsm: dsmSampler,
          segsPx,
          preserveOriginalMaskCoverage: preserveSimpleGable,
        })
        splitMethod = 'dsm_plane'
      } else {
        labels = labelRoofMaskBySegments(workBin, width, height, segsPx)
      }
      const splitFacets = facetsFromSplitMask({
        bin: splitBin,
        labels,
        width,
        height,
        segsPx,
        segments: mergedSegments,
        pixelToLngLat,
      })
      const splitFiltered = filterSplitFacetsByPin(splitFacets, structureRef)
      const splitFilteredPin =
        splitFiltered.length > 0 ? splitFiltered : filterSplitFacetsByPin(splitFacets, pinRef)
      const splitOut = splitFilteredPin.length > 0 ? splitFilteredPin : splitFiltered
      if (splitOut.length > 0 && splitFacetsMeetMaskQualityThreshold(splitOut)) {
        return maskAttempt('ok', splitOut, {
          ...baseDetails,
          mask_width: width,
          mask_height: height,
          split_plane_count: splitOut.length,
          merged_segment_count: mergedSegments.length,
          excluded_accessory_segment_count: excludedAccessoryIndices.size,
          path: 'split_mask_plane',
          split_method: splitMethod,
        })
      }
      if (splitFacets.length > 0 && splitOut.length === 0) {
        const nearestDist =
          splitFacets.length > 0
            ? Math.min(
                ...splitFacets.map((f) => {
                  const vs = f.lat_lng_vertices
                  const c = {
                    lat: vs.reduce((s, p) => s + p.lat, 0) / vs.length,
                    lng: vs.reduce((s, p) => s + p.lng, 0) / vs.length,
                  }
                  return distanceMeters(ref, c)
                })
              )
            : null
        console.info('[solar-mask] split planes missed pin filter', {
          ...baseDetails,
          split_raw_count: splitFacets.length,
          nearest_split_m: nearestDist,
        })
        // Try whole-roof before giving up on this query.
      } else if (splitOut.length > 0) {
        const maxSqft = Math.max(
          ...splitOut.map((f) => f.estimated_sq_ft ?? planarPolygonAreaSqFt(f.lat_lng_vertices))
        )
        console.info('[solar-mask] split planes below quality threshold; whole-roof fallback', {
          ...baseDetails,
          split_filtered_count: splitOut.length,
          max_plane_sqft: maxSqft,
          min_required_sqft: MIN_PLANE_FOOTPRINT_SQFT,
        })
      }
    }

    let rings = contourRingsFromMask(workBin, width, height)
    rings = rings.filter((r) => polygonAreaPx(r) >= MIN_RING_AREA_PX)

    if (rings.length === 0) {
      return maskAttempt('no_roof_pixels', null, {
        ...baseDetails,
        mask_width: width,
        mask_height: height,
        contour_rings: 0,
      })
    }

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

    let scored = scoredAll.filter(
      (x) => x.containsPin || x.dist <= PIN_MATCH_MAX_METERS || x.dist <= WHOLE_CONTOUR_PIN_MAX_METERS
    )
    if (scored.length === 0 && scoredAll.length > 0) {
      scored = [scoredAll[0]]
    }
    if (scored.length === 0) {
      const nearestM = scoredAll[0]?.dist ?? null
      return maskAttempt('whole_contour_pin_miss', null, {
        ...baseDetails,
        contour_rings: rings.length,
        nearest_contour_m: nearestM,
        ref_px_ok: refPx != null,
        structure_ref_lat: structureRef.lat,
        structure_ref_lng: structureRef.lng,
      })
    }

    const picked = scored
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
        ...segmentFacetSuggestions(seg),
        facet_source: 'solar_mask_whole',
      })
    }

    if (out.length > 0) {
      return maskAttempt('ok', out, {
        ...baseDetails,
        mask_width: width,
        mask_height: height,
        whole_contour_count: out.length,
        path: 'whole_mask_contour',
      })
    }

    return maskAttempt('whole_contour_pin_miss', null, {
      ...baseDetails,
      contour_rings: rings.length,
    })
  } catch (e) {
    console.warn('[solar-mask] unexpected error:', e)
    return maskAttempt('unexpected_error', null, {
      ...baseDetails,
      error: e instanceof Error ? e.message : 'unknown',
    })
  }
}
