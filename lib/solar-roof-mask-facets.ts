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
  /** Pitches (° ) of raw Solar fragments folded into this plane — homogeneity gate. */
  constituent_pitches?: number[]
  /** Ground areas (m²) paired with {@link constituent_pitches} for area-weighted checks. */
  constituent_ground_areas?: number[]
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
/**
 * Hard ceiling on split-plane vertex count, checked after polish. `MAX_VERTICES_PER_SPLIT_RING`
 * is a soft UI budget that {@link polishUsableSplitVertexCap} tries to hit but may deliberately
 * exceed when capping would break quality/coverage (see its uncapped-first fallback). Without
 * an absolute floor, that fallback can ship raw raster-staircase contours (100s of vertices) as
 * "editable" planes. Any plane still above this after polish means the split is not usable as
 * field-editable faces at all — {@link selectUsableSplitFacets} returns null so the caller falls
 * back to the whole-mask contour (a clean outline + a robust full-coverage total) instead.
 */
// 90 leaves margin above clean raster split planes (observed ≤ ~61) and the 72 soft budget,
// while rejecting planes the polish could only cap to 100–200 — those are still staircases and
// belong on the clean whole-mask contour, not shipped as "editable" faces.
const MAX_ABSOLUTE_SPLIT_VERTICES = 90
/** Douglas–Peucker tolerance (mask px ≈ 0.1 m) to straighten split-plane contour edges. */
const SPLIT_RING_SIMPLIFY_EPS_PX = 4
/** Vertices with an interior angle below this are starburst/sliver spikes → removed. */
const SPLIT_RING_SPIKE_MIN_ANGLE_DEG = 20
/** Cross-facet vertices within this distance weld to a shared junction point. */
const SHARED_VERTEX_WELD_METERS = 0.5
/** Split plane contours below this footprint fail the mask-quality gate (bbox/whole fallback). */
const MIN_PLANE_FOOTPRINT_SQFT = 35
/** Reject a split when contour cleanup loses a meaningful part of the source roof mask. */
const MIN_SPLIT_TO_MASK_AREA_RATIO = 0.88
/** Reject a split when hull/simplification/welding materially overfills the source mask. */
const MAX_SPLIT_TO_MASK_AREA_RATIO = 1.08
/**
 * Relaxed coverage band used only when the strict gate fails. Prefer a slightly
 * under/over-covered multi-plane split over a single whole-roof blob (which collapses
 * gables to one downslope) or rough Solar bboxes.
 * Field roofs often lose ~30% of mask area to contour cleanup / pin filtering —
 * still far more usable than bbox or one-blob whole-mask.
 */
const MIN_SPLIT_TO_MASK_AREA_RATIO_RELAXED = 0.65
const MAX_SPLIT_TO_MASK_AREA_RATIO_RELAXED = 1.25
/** Drop split planes smaller than this fraction of the largest sibling (noise slivers). */
const SPLIT_SLIVER_MAX_FRACTION_OF_LARGEST = 0.08
/**
 * Accept convex-hull regularization only when it barely changes area — i.e. the plane
 * is already essentially convex, so the hull just crisps a rectangular outline. A larger
 * ratio means the plane is genuinely concave (L-shape, valley edge, dormer cut-in), where
 * a hull would fill the notch: inflating the measured area and overlapping the neighbor.
 */
const CONVEX_HULL_MAX_INFLATION = 1.06

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

/** Interior angle (degrees) at `curr` between edges curr→prev and curr→next. */
function interiorAngleDeg(
  prev: [number, number],
  curr: [number, number],
  next: [number, number]
): number {
  const v1x = prev[0] - curr[0]
  const v1y = prev[1] - curr[1]
  const v2x = next[0] - curr[0]
  const v2y = next[1] - curr[1]
  const m1 = Math.hypot(v1x, v1y)
  const m2 = Math.hypot(v2x, v2y)
  if (m1 === 0 || m2 === 0) return 180
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)))
  return (Math.acos(cos) * 180) / Math.PI
}

/**
 * Remove starburst/sliver spikes: vertices whose interior angle is very acute are the
 * tip of a thin, near-zero-area protrusion created where independently-contoured planes
 * pinch to a point at a junction. Removing them (iteratively) preserves real roof
 * corners (well above the threshold) and does not change the plane's area meaningfully.
 */
function removeSpikeVertices(ring: [number, number][], minAngleDeg: number): [number, number][] {
  const pts = openRingPoints(ring)
  if (pts.length <= 3) return closeRing(pts)
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]
      const next = pts[(i + 1) % pts.length]
      if (interiorAngleDeg(prev, pts[i], next) < minAngleDeg) {
        pts.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return closeRing(pts)
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

/** Smallest edge-aligned rectangle enclosing a convex ring (brute-force rotating calipers). */
function minimumAreaBoundingRectangle(ring: [number, number][]): [number, number][] | null {
  const points = openRingPoints(ring)
  if (points.length < 3) return null
  let best: { area: number; ring: [number, number][] } | null = null
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of points) {
      const x = point[0] * cos + point[1] * sin
      const y = -point[0] * sin + point[1] * cos
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    const area = (maxX - minX) * (maxY - minY)
    if (best && area >= best.area) continue
    const unrotate = (x: number, y: number): [number, number] => [
      x * cos - y * sin,
      x * sin + y * cos,
    ]
    best = {
      area,
      ring: closeRing([
        unrotate(minX, minY),
        unrotate(maxX, minY),
        unrotate(maxX, maxY),
        unrotate(minX, maxY),
      ]),
    }
  }
  return best?.ring ?? null
}

type LatLng = { lat: number; lng: number }

function openLatLngRing(ring: LatLng[]): LatLng[] {
  if (ring.length < 2) return ring
  const a = ring[0]
  const b = ring[ring.length - 1]
  if (a.lat === b.lat && a.lng === b.lng) return ring.slice(0, -1)
  return ring.slice()
}

/** Smallest effective triangle area at vertex `i` — Visvalingam-style removal score. */
function latLngVertexRemovalScore(open: LatLng[], i: number): number {
  const prev = open[(i - 1 + open.length) % open.length]
  const curr = open[i]
  const next = open[(i + 1) % open.length]
  return Math.abs(
    (prev.lng - curr.lng) * (next.lat - curr.lat) - (prev.lat - curr.lat) * (next.lng - curr.lng)
  )
}

/**
 * Cap a split-plane lat/lng ring to {@link MAX_VERTICES_PER_SPLIT_RING} open vertices.
 * Removes least-significant corners first so shared boundaries stay stable and
 * adjacent planes do not pick up interior overlap from even decimation.
 */
function simplifyClosedLatLngRing(ring: LatLng[], maxVertices: number): LatLng[] {
  let open = openLatLngRing(ring)
  if (open.length <= maxVertices) return open
  while (open.length > maxVertices) {
    let bestIdx = 0
    let bestScore = Infinity
    for (let i = 0; i < open.length; i++) {
      const score = latLngVertexRemovalScore(open, i)
      if (score < bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    open = open.filter((_, i) => i !== bestIdx)
  }
  return open
}

function simplifySplitFacetsVertexCap(
  facets: SolarMaskFacetPayload[],
  maxVertices: number = MAX_VERTICES_PER_SPLIT_RING
): SolarMaskFacetPayload[] {
  return facets.map((facet) => {
    if (facet.lat_lng_vertices.length <= maxVertices) return facet
    const latLngVertices = simplifyClosedLatLngRing(facet.lat_lng_vertices, maxVertices)
    return {
      ...facet,
      lat_lng_vertices: latLngVertices,
      estimated_sq_ft: Math.round(planarPolygonAreaSqFt(latLngVertices)),
    }
  })
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

/** Near-flat top-of-gable segments (DSM rounds the ridge into a thin flat plane). */
const RIDGE_PEAK_MAX_PITCH_DEG = 8
const RIDGE_STEEP_MIN_PITCH_DEG = 15
const RIDGE_PEAK_MAX_GROUND_FRACTION = 0.4

/**
 * Identify Solar segments that are the DSM-rounded ridge/peak of a pitched roof rather
 * than a real plane: near-flat, sitting AT OR ABOVE the steep planes' center heights (a
 * genuine flat porch/addition sits LOWER, at eave level), and small relative to the steep
 * roof. These are dropped as plane TARGETS only — their mask pixels stay and flow to the
 * adjacent slopes, which then meet at the ridge line instead of leaving a flat sliver facet.
 */
export function ridgePeakSegmentIndices(segments: SolarMaskSegment[]): Set<number> {
  const out = new Set<number>()
  const steep = segments.filter(
    (s) => typeof s.pitch_degrees === 'number' && s.pitch_degrees >= RIDGE_STEEP_MIN_PITCH_DEG
  )
  if (steep.length < 2) return out
  const steepHeights = steep
    .map((s) => s.plane_height_at_center_meters)
    .filter((h): h is number => typeof h === 'number' && Number.isFinite(h))
  if (steepHeights.length === 0) return out
  const sorted = [...steepHeights].sort((a, b) => a - b)
  const medianSteepHeight = sorted[Math.floor(sorted.length / 2)]
  const steepGround = steep.reduce((sum, s) => sum + (s.ground_area_m2 ?? 0), 0)
  if (steepGround <= 0) return out
  for (const s of segments) {
    const pitch = s.pitch_degrees
    const height = s.plane_height_at_center_meters
    const ground = s.ground_area_m2
    if (
      typeof pitch === 'number' &&
      typeof height === 'number' &&
      typeof ground === 'number' &&
      pitch < RIDGE_PEAK_MAX_PITCH_DEG &&
      height >= medianSteepHeight &&
      ground < RIDGE_PEAK_MAX_GROUND_FRACTION * steepGround
    ) {
      out.add(s.segment_index)
    }
  }
  return out
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
type Point2 = { lat: number; lng: number }

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng)
}

function properSegmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  const eps = 1e-14
  // Touching or shared boundary vertices are valid between adjacent roof planes.
  if (Math.abs(abC) <= eps || Math.abs(abD) <= eps || Math.abs(cdA) <= eps || Math.abs(cdB) <= eps) {
    return false
  }
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)
}

function polygonSelfIntersects(points: Point2[]): boolean {
  if (points.length < 3) return true
  for (let i = 0; i < points.length; i++) {
    const iNext = (i + 1) % points.length
    for (let j = i + 1; j < points.length; j++) {
      const jNext = (j + 1) % points.length
      if (i === j || iNext === j || jNext === i) continue
      if (i === 0 && jNext === 0) continue
      if (properSegmentsIntersect(points[i], points[iNext], points[j], points[jNext])) return true
    }
  }
  return false
}

function pointStrictlyInsidePolygon(point: Point2, polygon: Point2[]): boolean {
  // Boundary points are intentionally not considered inside: adjacent facets share edges.
  const boundaryEps = 1e-12
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const cross = orientation(a, b, point)
    const withinLng = point.lng >= Math.min(a.lng, b.lng) - boundaryEps && point.lng <= Math.max(a.lng, b.lng) + boundaryEps
    const withinLat = point.lat >= Math.min(a.lat, b.lat) - boundaryEps && point.lat <= Math.max(a.lat, b.lat) + boundaryEps
    if (Math.abs(cross) <= boundaryEps && withinLng && withinLat) return false
  }
  return pointInPolygonLngLat(point, polygon)
}

function polygonsOverlapInterior(a: Point2[], b: Point2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const aNext = (i + 1) % a.length
    for (let j = 0; j < b.length; j++) {
      const bNext = (j + 1) % b.length
      if (properSegmentsIntersect(a[i], a[aNext], b[j], b[bNext])) return true
    }
  }
  return a.some((point) => pointStrictlyInsidePolygon(point, b)) ||
    b.some((point) => pointStrictlyInsidePolygon(point, a))
}

function splitPlaneFootprintSqft(facet: SolarMaskFacetPayload): number {
  return facet.estimated_sq_ft ?? Math.round(planarPolygonAreaSqFt(facet.lat_lng_vertices))
}

function splitPlanesAreIndividuallyValid(planes: SolarMaskFacetPayload[]): boolean {
  if (planes.length === 0) return false
  if (!planes.every((f) => {
    if (f.facet_source !== 'solar_mask_plane') return false
    if (f.lat_lng_vertices.length < 3 || polygonSelfIntersects(f.lat_lng_vertices)) return false
    return splitPlaneFootprintSqft(f) >= MIN_PLANE_FOOTPRINT_SQFT
  })) return false
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      if (polygonsOverlapInterior(planes[i].lat_lng_vertices, planes[j].lat_lng_vertices)) return false
    }
  }
  return true
}

export function splitFacetsMeetMaskQualityThreshold(
  facets: SolarMaskFacetPayload[],
  targetMaskFootprintSqft?: number
): boolean {
  const planes = facets.filter((f) => f.facet_source === 'solar_mask_plane')
  if (planes.length === 0 || planes.length !== facets.length) return false
  if (!splitPlanesAreIndividuallyValid(planes)) return false

  if (typeof targetMaskFootprintSqft === 'number' && targetMaskFootprintSqft > 0) {
    const splitSqft = planes.reduce((sum, facet) => sum + splitPlaneFootprintSqft(facet), 0)
    const ratio = splitSqft / targetMaskFootprintSqft
    if (ratio < MIN_SPLIT_TO_MASK_AREA_RATIO || ratio > MAX_SPLIT_TO_MASK_AREA_RATIO) return false
  }
  return true
}

/**
 * Looser coverage gate for usable multi-plane splits. Still requires non-overlapping,
 * min-area solar_mask_plane polygons — only the mask-coverage band is widened.
 */
export function splitFacetsMeetRelaxedMaskQualityThreshold(
  facets: SolarMaskFacetPayload[],
  targetMaskFootprintSqft?: number
): boolean {
  const planes = facets.filter((f) => f.facet_source === 'solar_mask_plane')
  if (planes.length < 2 || planes.length !== facets.length) return false
  if (!splitPlanesAreIndividuallyValid(planes)) return false

  if (typeof targetMaskFootprintSqft === 'number' && targetMaskFootprintSqft > 0) {
    const splitSqft = planes.reduce((sum, facet) => sum + splitPlaneFootprintSqft(facet), 0)
    const ratio = splitSqft / targetMaskFootprintSqft
    if (ratio < MIN_SPLIT_TO_MASK_AREA_RATIO_RELAXED || ratio > MAX_SPLIT_TO_MASK_AREA_RATIO_RELAXED) {
      return false
    }
  }
  return true
}

/**
 * Drop tiny sibling slivers that commonly fail the strict "every plane ≥ min" gate,
 * then keep the remaining multi-plane set if it still looks like a real roof.
 */
export function pruneSplitPlaneSlivers(facets: SolarMaskFacetPayload[]): SolarMaskFacetPayload[] {
  const planes = facets.filter((f) => f.facet_source === 'solar_mask_plane')
  if (planes.length < 2) return facets
  const areas = planes.map(splitPlaneFootprintSqft)
  const largest = Math.max(...areas)
  const minKeep = Math.max(MIN_PLANE_FOOTPRINT_SQFT, largest * SPLIT_SLIVER_MAX_FRACTION_OF_LARGEST)
  const kept = planes.filter((_, i) => areas[i] >= minKeep)
  return kept.length >= 2 ? kept : planes
}

/**
 * Keep the largest non-overlapping multi-plane subset. Contour simplify / weld often
 * leaves one overlapping pair that would otherwise discard an otherwise-good split.
 * Exact search (n ≤ 16): maximize plane count, then total footprint area.
 */
export function largestNonOverlappingPlaneSubset(
  facets: SolarMaskFacetPayload[]
): SolarMaskFacetPayload[] {
  const valid = facets
    .filter((f) => f.facet_source === 'solar_mask_plane')
    .filter((plane) => {
      if (polygonSelfIntersects(plane.lat_lng_vertices)) return false
      return splitPlaneFootprintSqft(plane) >= MIN_PLANE_FOOTPRINT_SQFT
    })
    .sort((a, b) => splitPlaneFootprintSqft(b) - splitPlaneFootprintSqft(a))
    .slice(0, 16)
  if (valid.length < 2) return []

  const n = valid.length
  const areas = valid.map(splitPlaneFootprintSqft)
  const overlaps = Array.from({ length: n }, () => Array<boolean>(n).fill(false))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const hit = polygonsOverlapInterior(valid[i].lat_lng_vertices, valid[j].lat_lng_vertices)
      overlaps[i][j] = hit
      overlaps[j][i] = hit
    }
  }

  let bestMask = 0
  let bestCount = 0
  let bestArea = 0
  const subsetCount = 1 << n
  for (let mask = 1; mask < subsetCount; mask++) {
    let count = 0
    let area = 0
    let ok = true
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) === 0) continue
      count++
      area += areas[i]
      for (let j = i + 1; j < n; j++) {
        if ((mask & (1 << j)) === 0) continue
        if (overlaps[i][j]) {
          ok = false
          break
        }
      }
      if (!ok) break
    }
    if (!ok) continue
    if (count > bestCount || (count === bestCount && area > bestArea)) {
      bestCount = count
      bestArea = area
      bestMask = mask
    }
  }

  if (bestCount < 2) return []
  const kept: SolarMaskFacetPayload[] = []
  for (let i = 0; i < n; i++) {
    if (bestMask & (1 << i)) kept.push(valid[i])
  }
  return kept
}

/** A dropped facet at/above this footprint is a real roof plane, not a sliver. */
const GENUINE_FACET_MIN_SQFT = 50
/**
 * Area-based tolerance for {@link splitDropsGenuineFacet}: a split may drop genuine,
 * uncovered facets totalling up to this fraction of the source roof mask and still ship
 * (e.g. a small hip end lost to sliver-pruning on an otherwise-good multi-plane split —
 * ~5% is a rough-estimate rounding error, not an under-count worth degrading over).
 * Above this fraction the loss is material enough that the caller must defer to the
 * whole-mask contour (a robust total) instead of shipping an under-counted split.
 */
const MAX_DROPPED_GENUINE_FACET_MASK_FRACTION = 0.12

function facetCentroidLatLng(f: SolarMaskFacetPayload): { lat: number; lng: number } {
  const v = f.lat_lng_vertices
  return {
    lat: v.reduce((s, p) => s + p.lat, 0) / v.length,
    lng: v.reduce((s, p) => s + p.lng, 0) / v.length,
  }
}

function pointInLatLngPolygon(
  pt: { lat: number; lng: number },
  poly: { lat: number; lng: number }[]
): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng
    const yi = poly[i].lat
    const xj = poly[j].lng
    const yj = poly[j].lat
    if (yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * True when `kept` omits genuine (>= {@link GENUINE_FACET_MIN_SQFT}) facets whose footprint is
 * NOT covered by the kept planes — i.e. real roof area was lost. Dropping a spurious facet that
 * overlaps a kept plane (a duplicate detection) is fine and does not count; dropping separate
 * real facets (e.g. a hip end pruned as a relative sliver) does.
 *
 * Area-based, not per-facet: a single dropped genuine facet does not fail the split by itself —
 * the footprints of ALL dropped, uncovered, genuine facets are summed and compared against
 * {@link MAX_DROPPED_GENUINE_FACET_MASK_FRACTION} of `targetMaskFootprintSqft`. A small lost
 * roof end (a few percent of the mask) is tolerable for a rough estimate and keeps an otherwise
 * usable multi-plane split; losing more than that fraction is a material under-count, so the
 * caller degrades to the whole-mask contour (a robust total) instead.
 *
 * When `targetMaskFootprintSqft` is not provided (no denominator to compute a fraction against),
 * fails closed on the old per-facet rule: any genuine, uncovered, dropped facet degrades the split.
 */
export function splitDropsGenuineFacet(
  original: SolarMaskFacetPayload[],
  kept: SolarMaskFacetPayload[],
  targetMaskFootprintSqft?: number
): boolean {
  const keptIds = new Set(kept.map((f) => f.id))
  const hasTarget = typeof targetMaskFootprintSqft === 'number' && targetMaskFootprintSqft > 0
  let droppedGenuineSqft = 0
  for (const f of original) {
    if (keptIds.has(f.id)) continue
    const sqft = splitPlaneFootprintSqft(f)
    if (sqft < GENUINE_FACET_MIN_SQFT) continue
    const centroid = facetCentroidLatLng(f)
    const coveredByKept = kept.some((k) => pointInLatLngPolygon(centroid, k.lat_lng_vertices))
    if (coveredByKept) continue
    if (!hasTarget) return true
    droppedGenuineSqft += sqft
  }
  if (!hasTarget) return false
  return droppedGenuineSqft / targetMaskFootprintSqft! > MAX_DROPPED_GENUINE_FACET_MASK_FRACTION
}

type UsableSplitMode = 'strict' | 'pruned' | 'relaxed' | 'nonoverlap'

function cascadeUsableSplitFacets(
  candidateFacets: SolarMaskFacetPayload[],
  originalFacets: SolarMaskFacetPayload[],
  targetMaskFootprintSqft?: number
): { facets: SolarMaskFacetPayload[]; mode: UsableSplitMode } | null {
  if (candidateFacets.length === 0) return null
  if (splitFacetsMeetMaskQualityThreshold(candidateFacets, targetMaskFootprintSqft)) {
    return { facets: candidateFacets, mode: 'strict' }
  }
  const pruned = pruneSplitPlaneSlivers(candidateFacets)
  if (
    pruned.length !== candidateFacets.length &&
    !splitDropsGenuineFacet(originalFacets, pruned, targetMaskFootprintSqft) &&
    splitFacetsMeetMaskQualityThreshold(pruned, targetMaskFootprintSqft)
  ) {
    return { facets: pruned, mode: 'pruned' }
  }
  const relaxedCandidate = pruned.length >= 2 ? pruned : candidateFacets
  if (
    !splitDropsGenuineFacet(originalFacets, relaxedCandidate, targetMaskFootprintSqft) &&
    splitFacetsMeetRelaxedMaskQualityThreshold(relaxedCandidate, targetMaskFootprintSqft)
  ) {
    return { facets: relaxedCandidate, mode: 'relaxed' }
  }

  const nonOverlap = largestNonOverlappingPlaneSubset(relaxedCandidate)
  if (nonOverlap.length >= 2 && !splitDropsGenuineFacet(originalFacets, nonOverlap, targetMaskFootprintSqft)) {
    if (splitFacetsMeetMaskQualityThreshold(nonOverlap, targetMaskFootprintSqft)) {
      return { facets: nonOverlap, mode: 'nonoverlap' }
    }
    if (splitFacetsMeetRelaxedMaskQualityThreshold(nonOverlap, targetMaskFootprintSqft)) {
      return { facets: nonOverlap, mode: 'nonoverlap' }
    }
  }
  return null
}

function splitNeedsVertexCap(facets: SolarMaskFacetPayload[]): boolean {
  return facets.some((facet) => facet.lat_lng_vertices.length > MAX_VERTICES_PER_SPLIT_RING)
}

/**
 * Soft-cap vertices on an already-accepted split. Try progressively tighter budgets so
 * complex roofs (Cambridge) can shed raster staircase without introducing interior overlap.
 * Keep uncapped when every polish budget invalidates the split.
 */
function polishUsableSplitVertexCap(
  accepted: { facets: SolarMaskFacetPayload[]; mode: UsableSplitMode },
  originalFacets: SolarMaskFacetPayload[],
  targetMaskFootprintSqft?: number
): { facets: SolarMaskFacetPayload[]; mode: UsableSplitMode } {
  if (!splitNeedsVertexCap(accepted.facets)) return accepted

  const budgets = [200, 140, 100, MAX_VERTICES_PER_SPLIT_RING]
  for (const budget of budgets) {
    if (!accepted.facets.some((f) => f.lat_lng_vertices.length > budget)) continue
    const capped = simplifySplitFacetsVertexCap(accepted.facets, budget)
    if (splitDropsGenuineFacet(originalFacets, capped, targetMaskFootprintSqft)) continue

    if (splitFacetsMeetMaskQualityThreshold(capped, targetMaskFootprintSqft)) {
      return {
        facets: capped,
        mode: accepted.mode === 'relaxed' ? 'relaxed' : accepted.mode,
      }
    }
    if (splitFacetsMeetRelaxedMaskQualityThreshold(capped, targetMaskFootprintSqft)) {
      return { facets: capped, mode: 'relaxed' }
    }
  }
  return accepted
}

/**
 * Absolute vertex ceiling applied to whichever candidate {@link selectUsableSplitFacets} is about
 * to return, regardless of cascade path: polish may deliberately leave a split uncapped when
 * capping breaks quality, so this is the true floor stopping raw raster-staircase "planes" from
 * shipping as editable faces. Failure returns null so the caller falls back to the whole-mask
 * contour.
 */
function finalizeUsableSplit(
  candidate: { facets: SolarMaskFacetPayload[]; mode: UsableSplitMode } | null
): { facets: SolarMaskFacetPayload[]; mode: UsableSplitMode } | null {
  if (!candidate) return null
  if (candidate.facets.some((f) => f.lat_lng_vertices.length > MAX_ABSOLUTE_SPLIT_VERTICES)) {
    if (process.env.ROOF_MEASURE_DEBUG_USABLE_SPLIT === '1') {
      console.info('[selectUsableSplitFacets] rejected', {
        path: 'absolute_vertex_ceiling',
        mode: candidate.mode,
        vertexCounts: candidate.facets.map((f) => f.lat_lng_vertices.length),
        ceiling: MAX_ABSOLUTE_SPLIT_VERTICES,
      })
    }
    return null
  }
  return candidate
}

/**
 * When the strict quality gate fails, prefer a cleaned/relaxed multi-plane split over
 * falling through to whole-roof (one downslope for a gable) or Solar bboxes. A degraded
 * candidate that drops a genuine, uncovered facet is rejected (returns null) so the caller
 * falls back to the whole-mask contour — a robust total for the public estimate and an honest
 * "outline only" for ordering, instead of an under-counted partial split.
 *
 * Happy medium vs vertex budget: try the uncapped contours first (they often already pass
 * relaxed). Vertex-cap is polish — never reject a usable uncapped split because capping
 * introduced overlap. Only run the capped cascade when the uncapped contours fail.
 *
 * Every candidate this function would return passes through {@link finalizeUsableSplit} first:
 * an absolute vertex ceiling, biased to fail closed / defer to the whole-mask contour rather
 * than ship an unusable raster-staircase split.
 */
export function selectUsableSplitFacets(
  facets: SolarMaskFacetPayload[],
  targetMaskFootprintSqft?: number
): {
  facets: SolarMaskFacetPayload[]
  mode: UsableSplitMode
} | null {
  if (facets.length === 0) return null

  const uncapped = cascadeUsableSplitFacets(facets, facets, targetMaskFootprintSqft)
  if (uncapped) {
    const polished = polishUsableSplitVertexCap(uncapped, facets, targetMaskFootprintSqft)
    return finalizeUsableSplit(polished)
  }

  if (!splitNeedsVertexCap(facets)) {
    if (process.env.ROOF_MEASURE_DEBUG_USABLE_SPLIT === '1') {
      console.info('[selectUsableSplitFacets] rejected', {
        path: 'uncapped_only',
        origVertexCounts: facets.map((f) => f.lat_lng_vertices.length),
      })
    }
    return null
  }

  const cappedFacets = simplifySplitFacetsVertexCap(facets)
  const capped = cascadeUsableSplitFacets(cappedFacets, facets, targetMaskFootprintSqft)
  if (capped) return finalizeUsableSplit(capped)

  if (process.env.ROOF_MEASURE_DEBUG_USABLE_SPLIT === '1') {
    const planes = cappedFacets.filter((f) => f.facet_source === 'solar_mask_plane')
    let overlapping = 0
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        if (polygonsOverlapInterior(planes[i].lat_lng_vertices, planes[j].lat_lng_vertices)) overlapping++
      }
    }
    console.info('[selectUsableSplitFacets] rejected', {
      path: 'uncapped_then_capped',
      strict: splitFacetsMeetMaskQualityThreshold(cappedFacets, targetMaskFootprintSqft),
      relaxed: splitFacetsMeetRelaxedMaskQualityThreshold(cappedFacets, targetMaskFootprintSqft),
      origVertexCounts: facets.map((f) => f.lat_lng_vertices.length),
      vertexCounts: cappedFacets.map((f) => f.lat_lng_vertices.length),
      overlapping_pairs: overlapping,
    })
  }

  return null
}

/** Diagnostic reasons for live diagnose / logs when a split is discarded. */
export function explainSplitQualityRejection(
  facets: SolarMaskFacetPayload[],
  targetMaskFootprintSqft?: number
): {
  plane_count: number
  areas_sqft: number[]
  coverage_ratio: number | null
  self_intersecting: number
  overlapping_pairs: number
  below_min_area: number
  non_plane_sources: number
  pruned_plane_count: number
  strict_ok: boolean
  relaxed_ok: boolean
  usable_mode: 'strict' | 'pruned' | 'relaxed' | 'nonoverlap' | null
  vertex_capped: boolean
} {
  const vertexCapped = facets.some((f) => f.lat_lng_vertices.length > MAX_VERTICES_PER_SPLIT_RING)
  const planes = facets.filter((f) => f.facet_source === 'solar_mask_plane')
  const areas = planes.map(splitPlaneFootprintSqft)
  const sum = areas.reduce((a, b) => a + b, 0)
  const coverage =
    typeof targetMaskFootprintSqft === 'number' && targetMaskFootprintSqft > 0
      ? sum / targetMaskFootprintSqft
      : null
  let overlapping = 0
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      if (polygonsOverlapInterior(planes[i].lat_lng_vertices, planes[j].lat_lng_vertices)) {
        overlapping++
      }
    }
  }
  const pruned = pruneSplitPlaneSlivers(facets)
  const usable = selectUsableSplitFacets(facets, targetMaskFootprintSqft)
  return {
    plane_count: planes.length,
    areas_sqft: areas.map((a) => Math.round(a)),
    coverage_ratio: coverage == null ? null : Math.round(coverage * 1000) / 1000,
    self_intersecting: planes.filter((f) => polygonSelfIntersects(f.lat_lng_vertices)).length,
    overlapping_pairs: overlapping,
    below_min_area: areas.filter((a) => a < MIN_PLANE_FOOTPRINT_SQFT).length,
    non_plane_sources: facets.length - planes.length,
    pruned_plane_count: pruned.filter((f) => f.facet_source === 'solar_mask_plane').length,
    strict_ok: splitFacetsMeetMaskQualityThreshold(facets, targetMaskFootprintSqft),
    relaxed_ok: splitFacetsMeetRelaxedMaskQualityThreshold(
      pruned.length >= 2 ? pruned : facets,
      targetMaskFootprintSqft
    ),
    usable_mode: usable?.mode ?? null,
    vertex_capped: vertexCapped,
  }
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

function rasterMaskFootprintSqft(
  bin: Uint8Array,
  width: number,
  height: number,
  pixelToLngLat: (col: number, row: number) => { lat: number; lng: number }
): number | null {
  if (width < 2 || height < 2) return null
  const origin = pixelToLngLat(0, 0)
  const colStep = pixelToLngLat(1, 0)
  const rowStep = pixelToLngLat(0, 1)
  const pixelAreaSqft = distanceMeters(origin, colStep) * distanceMeters(origin, rowStep) * 10.7639
  if (!Number.isFinite(pixelAreaSqft) || pixelAreaSqft <= 0) return null
  let pixels = 0
  for (let i = 0; i < bin.length; i++) if (bin[i] === 1) pixels++
  return pixels > 0 ? pixels * pixelAreaSqft : null
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
/**
 * Pitch gaps at or below this are treated as Solar noise on one physical plane (center-height
 * coplanarity is enough). Gaps above this but ≤ {@link COPLANAR_PITCH_TOLERANCE_DEG} only merge
 * when the smaller fragment's center sits inside the larger fragment's Solar bbox — otherwise a
 * shallower dormer at the main slope's elevation fools the center-height check (Greenway #5/#9).
 */
const COPLANAR_PITCH_SOFT_DEG = 4
const COPLANAR_HEIGHT_TOLERANCE_M = 1
/**
 * After merge+split: reject any shipped plane whose constituents are pitch-heterogeneous.
 * Uses area-weighted max deviation from the mean AND raw pitch span so a transitive merge
 * chain (e.g. 14°→20°→26°) cannot hide under a soft mean while still spanning a dormer.
 */
const MAX_MERGED_PLANE_PITCH_DEV_DEG = 6
const MAX_MERGED_PLANE_PITCH_SPAN_DEG = 8

/**
 * Max |pitch − area-weighted mean| across constituent fragments. Used by the post-split
 * homogeneity gate so a plane that absorbed a distinct-pitch structure fails closed.
 */
export function areaWeightedPitchMaxDeviationDegrees(
  pitches: number[],
  weights: number[]
): number {
  if (pitches.length === 0) return 0
  let totalWeight = 0
  let weightedSum = 0
  for (let i = 0; i < pitches.length; i++) {
    const pitch = pitches[i]
    if (!Number.isFinite(pitch)) continue
    const w = Math.max(weights[i] ?? 1, 0.01)
    totalWeight += w
    weightedSum += pitch * w
  }
  if (totalWeight <= 0) return 0
  const mean = weightedSum / totalWeight
  let maxDev = 0
  for (let i = 0; i < pitches.length; i++) {
    const pitch = pitches[i]
    if (!Number.isFinite(pitch)) continue
    maxDev = Math.max(maxDev, Math.abs(pitch - mean))
  }
  return maxDev
}

export function pitchSpanDegrees(pitches: number[]): number {
  const finite = pitches.filter((p) => Number.isFinite(p))
  if (finite.length === 0) return 0
  return Math.max(...finite) - Math.min(...finite)
}

/**
 * True when any merged plane's constituents are too pitch-heterogeneous for safe ordering.
 */
export function mergedPlanesFailPitchHomogeneity(
  mergedSegments: SolarMaskSegment[],
  maxDeviationDeg: number = MAX_MERGED_PLANE_PITCH_DEV_DEG,
  maxSpanDeg: number = MAX_MERGED_PLANE_PITCH_SPAN_DEG
): boolean {
  for (const segment of mergedSegments) {
    const pitches =
      segment.constituent_pitches ??
      (segment.pitch_degrees != null && Number.isFinite(segment.pitch_degrees)
        ? [segment.pitch_degrees]
        : [])
    if (pitches.length < 2) continue
    const weights =
      segment.constituent_ground_areas ??
      pitches.map((_, i) => {
        if (segment.constituent_pitches == null && i === 0) {
          return Math.max(segment.ground_area_m2 ?? segment.area_m2 ?? 1, 0.01)
        }
        return 1
      })
    const maxDev = areaWeightedPitchMaxDeviationDegrees(pitches, weights)
    const span = pitchSpanDegrees(pitches)
    // >= on deviation so a balanced 14/20/26 chain (dev exactly 6) fails closed.
    if (maxDev >= maxDeviationDeg || span > maxSpanDeg) {
      return true
    }
  }
  return false
}

/** Reject connected mask pixels that are not close to any known Solar plane (for example, a low porch). */
const MAX_DSM_PLANE_HEIGHT_ERROR_M = Number(
  process.env.ROOF_MEASURE_DSM_MAX_PLANE_ERROR_M ?? '1.5'
)

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

function pointInSegmentBoundingBox(
  point: { lat: number; lng: number },
  box: NonNullable<SolarMaskSegment['bounding_box']>
): boolean {
  return (
    point.lat >= box.sw.lat &&
    point.lat <= box.ne.lat &&
    point.lng >= box.sw.lng &&
    point.lng <= box.ne.lng
  )
}

/**
 * Merge Solar fragments that describe the same physical roof plane. Solar sometimes
 * subdivides a simple face into several near-identical segments (observed at 276
 * Epworth), which otherwise produces blocky internal seams. Direction/pitch alone is
 * insufficient because dormers may be parallel, so both plane equations must also
 * predict the other segment center's elevation within a tight tolerance.
 *
 * Pitch-soft gaps (≤ {@link COPLANAR_PITCH_SOFT_DEG}) merge on center-height coplanarity alone
 * (same-pitch shards). Larger gaps within the hard pitch tolerance additionally require the
 * smaller fragment's center to lie inside the larger fragment's Solar bbox — dormers that sit
 * at the main plane's elevation but are not nested bbox-shards stay separate (Greenway).
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
  if (eligible.length < 2) {
    return segments.map((segment) => annotateConstituentPitchMetadata(segment, [segment]))
  }

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
      const pitchGap = Math.abs((a.pitch_degrees as number) - (b.pitch_degrees as number))
      if (
        circularDegreesDifference(a.azimuth_degrees as number, b.azimuth_degrees as number) >
          COPLANAR_AZIMUTH_TOLERANCE_DEG ||
        pitchGap > COPLANAR_PITCH_TOLERANCE_DEG
      ) {
        continue
      }
      const errAAtB = Math.abs(planePredictedHeight(pa, pb.cx, pb.cy) - pb.cz)
      const errBAtA = Math.abs(planePredictedHeight(pb, pa.cx, pa.cy) - pa.cz)
      if (Math.max(errAAtB, errBAtA) > COPLANAR_HEIGHT_TOLERANCE_M) {
        continue
      }
      // Material pitch gap: require nested Solar bbox (smaller center inside larger box).
      // Without a bbox we cannot prove nesting → keep separate (fail closed on merge).
      if (pitchGap > COPLANAR_PITCH_SOFT_DEG) {
        const weightA = Math.max(a.ground_area_m2 ?? a.area_m2 ?? 1, 0.01)
        const weightB = Math.max(b.ground_area_m2 ?? b.area_m2 ?? 1, 0.01)
        const smaller = weightA <= weightB ? a : b
        const larger = weightA <= weightB ? b : a
        if (
          !larger.bounding_box ||
          !smaller.center ||
          !pointInSegmentBoundingBox(smaller.center, larger.bounding_box)
        ) {
          continue
        }
      }
      union(a.segment_index, b.segment_index)
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
    if (group.length === 1) return annotateConstituentPitchMetadata(group[0], group)
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
    return annotateConstituentPitchMetadata(
      {
        ...representative,
        merged_segment_count: group.length,
        pitch_degrees: weighted((s) => s.pitch_degrees),
        azimuth_degrees: (Math.atan2(azY, azX) * 180) / Math.PI + (azY < 0 ? 360 : 0),
        area_m2: group.reduce((sum, s) => sum + (s.area_m2 ?? 0), 0),
        ground_area_m2: group.reduce((sum, s) => sum + (s.ground_area_m2 ?? 0), 0),
        plane_height_at_center_meters: weighted((s) => s.plane_height_at_center_meters),
        center: {
          lat:
            group.reduce((sum, s) => sum + (s.center?.lat ?? origin.lat) * weightOf(s), 0) /
            totalWeight,
          lng:
            group.reduce((sum, s) => sum + (s.center?.lng ?? origin.lng) * weightOf(s), 0) /
            totalWeight,
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
      },
      group
    )
  })
}

function annotateConstituentPitchMetadata(
  segment: SolarMaskSegment,
  group: SolarMaskSegment[]
): SolarMaskSegment {
  const pitches: number[] = []
  const areas: number[] = []
  for (const member of group) {
    if (member.constituent_pitches && member.constituent_pitches.length > 0) {
      for (let i = 0; i < member.constituent_pitches.length; i++) {
        pitches.push(member.constituent_pitches[i])
        areas.push(
          member.constituent_ground_areas?.[i] ??
            Math.max(member.ground_area_m2 ?? member.area_m2 ?? 1, 0.01)
        )
      }
    } else if (member.pitch_degrees != null && Number.isFinite(member.pitch_degrees)) {
      pitches.push(member.pitch_degrees)
      areas.push(Math.max(member.ground_area_m2 ?? member.area_m2 ?? 1, 0.01))
    }
  }
  return {
    ...segment,
    constituent_pitches: pitches.length > 0 ? pitches : segment.constituent_pitches,
    constituent_ground_areas: areas.length > 0 ? areas : segment.constituent_ground_areas,
  }
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
  } = options
  const labels = new Int32Array(width * height).fill(-1)
  if (planes.length === 0) return labels

  const mLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)
  // Solar plane heights and the DSM share a datum but can carry a small global vertical
  // offset. Correct it with ONE shared offset (median of each plane's center residual),
  // not a per-plane offset: a per-plane offset built from a single noisy DSM sample
  // shifts the height crossing between adjacent planes and misplaces the ridge —
  // over-growing one plane and shrinking its neighbor (Woodbury #0 593 / #1 339 vs
  // Solar 521 / 500). A shared offset fixes the datum without distorting boundaries.
  const centerResiduals: number[] = []
  for (const plane of planes) {
    const centerLat = origin.lat + plane.cy / M_PER_DEG_LAT
    const centerLng = origin.lng + plane.cx / mLng
    const centerDsm = sampleDsm(centerLat, centerLng)
    if (centerDsm != null && Number.isFinite(centerDsm)) centerResiduals.push(centerDsm - plane.cz)
  }
  const globalHeightOffset =
    centerResiduals.length > 0
      ? [...centerResiduals].sort((a, b) => a - b)[Math.floor(centerResiduals.length / 2)]
      : 0

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
        const predicted = planePredictedHeight(pl, x, y) + globalHeightOffset
        const err = Math.abs(dz - predicted)
        if (err < bd) {
          bd = err
          best = pl.segment_index
        }
      }
      // In-mask pixels are confirmed target roof, so always keep them (the DSM only
      // chooses which plane). Only bbox-expanded pixels outside the original mask
      // require a real plane-height match — none are added today, but the check keeps
      // the door open for a future dormer-recovery expansion without letting it bleed.
      const maxError = fallbackBin[i] === 1 ? Infinity : MAX_DSM_PLANE_HEIGHT_ERROR_M
      if (bd <= maxError) labels[i] = best
    }
  }

  majorityFilterLabels(labels, workBin, width, height, { minC, maxC, minR, maxR }, 3, 2)
  return labels
}

/** Fill a closed pixel ring into a binary mask (1 = inside). */
function rasterizeClosedRingToMask(
  ring: [number, number][],
  width: number,
  height: number,
  out?: Uint8Array
): Uint8Array {
  const mask = out ?? new Uint8Array(width * height)
  if (out) mask.fill(0)
  const open = openRingPoints(ring)
  if (open.length < 3) return mask
  let minC = Infinity
  let maxC = -Infinity
  let minR = Infinity
  let maxR = -Infinity
  for (const [x, y] of open) {
    minC = Math.min(minC, Math.floor(x))
    maxC = Math.max(maxC, Math.ceil(x))
    minR = Math.min(minR, Math.floor(y))
    maxR = Math.max(maxR, Math.ceil(y))
  }
  minC = Math.max(0, minC)
  maxC = Math.min(width - 1, maxC)
  minR = Math.max(0, minR)
  maxR = Math.min(height - 1, maxR)
  const closed = closeRing(open)
  for (let row = minR; row <= maxR; row++) {
    for (let col = minC; col <= maxC; col++) {
      if (pointInPolygonColRow(col + 0.5, row + 0.5, closed)) mask[row * width + col] = 1
    }
  }
  return mask
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

type PixelLine = { x: number; y: number; dx: number; dy: number; rms: number; span: number }

/** Fit one shared ridge through the raster boundary between exactly two plane labels. */
function fitTwoPlaneBoundaryLine(
  bin: Uint8Array,
  labels: Int32Array,
  width: number,
  height: number,
  aLabel: number,
  bLabel: number
): PixelLine | null {
  const points: [number, number][] = []
  const isPair = (a: number, b: number) =>
    (a === aLabel && b === bLabel) || (a === bLabel && b === aLabel)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (bin[i] !== 1) continue
      if (col + 1 < width && bin[i + 1] === 1 && isPair(labels[i], labels[i + 1])) {
        points.push([col + 1, row + 0.5])
      }
      if (row + 1 < height && bin[i + width] === 1 && isPair(labels[i], labels[i + width])) {
        points.push([col + 0.5, row + 1])
      }
    }
  }
  if (points.length < 8) return null
  const x = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const y = points.reduce((sum, p) => sum + p[1], 0) / points.length
  let xx = 0
  let xy = 0
  let yy = 0
  for (const p of points) {
    const px = p[0] - x
    const py = p[1] - y
    xx += px * px
    xy += px * py
    yy += py * py
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let minT = Infinity
  let maxT = -Infinity
  let residual2 = 0
  for (const p of points) {
    const px = p[0] - x
    const py = p[1] - y
    const along = px * dx + py * dy
    const across = px * -dy + py * dx
    minT = Math.min(minT, along)
    maxT = Math.max(maxT, along)
    residual2 += across * across
  }
  return { x, y, dx, dy, rms: Math.sqrt(residual2 / points.length), span: maxT - minT }
}

function clipRingToLineHalfPlane(
  ring: [number, number][],
  line: PixelLine,
  keepSign: number
): [number, number][] {
  const points = openRingPoints(ring)
  if (points.length < 3) return []
  const signed = (p: [number, number]) =>
    keepSign * (line.dx * (p[1] - line.y) - line.dy * (p[0] - line.x))
  const out: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    const currentD = signed(current)
    const nextD = signed(next)
    const currentInside = currentD >= -1e-9
    const nextInside = nextD >= -1e-9
    if (currentInside) out.push(current)
    if (currentInside !== nextInside) {
      const t = currentD / (currentD - nextD)
      out.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
      ])
    }
  }
  return closeRing(out)
}

/**
 * A simple two-slope gable should render like the field-drawn model: two clean outer
 * polygons meeting on one straight ridge. The exclusive label raster supplies the
 * split; clipping one shared whole-roof outline guarantees the halves cannot overlap.
 */
function simpleTwoPlaneGableRings(options: {
  bin: Uint8Array
  labels: Int32Array
  width: number
  height: number
  ordered: SegPx[]
}): Map<number, [number, number][]> | null {
  const { bin, labels, width, height, ordered } = options
  if (ordered.length !== 2) return null
  const line = fitTwoPlaneBoundaryLine(
    bin,
    labels,
    width,
    height,
    ordered[0].segment_index,
    ordered[1].segment_index
  )
  if (!line || line.span < 12 || line.rms > Math.max(3, line.span * 0.06)) return null

  const wholeRing = largestRing(
    contourRingsFromMask(bin, width, height, { smooth: false }).filter(
      (ring) => polygonAreaPx(ring) >= MIN_RING_AREA_PX
    )
  )
  if (!wholeRing) return null
  const hull = convexHullClosedRing(wholeRing)
  const wholeArea = polygonAreaPx(wholeRing)
  const hullArea = polygonAreaPx(hull)
  if (wholeArea <= 0) return null
  const hullIsSafe = hullArea / wholeArea <= CONVEX_HULL_MAX_INFLATION
  const rectangle = minimumAreaBoundingRectangle(hull)
  const rectangleArea = rectangle ? polygonAreaPx(rectangle) : Infinity
  const outline =
    hullIsSafe && rectangle && rectangleArea / wholeArea <= CONVEX_HULL_MAX_INFLATION
      ? rectangle
      : simplifyClosedRing(
          hullIsSafe ? hull : wholeRing,
          SPLIT_RING_SIMPLIFY_EPS_PX,
          MAX_VERTICES_PER_RING
        )
  if (outline.length < 4) return null

  const labelCenters = new Map<number, [number, number]>()
  for (const meta of ordered) {
    let sx = 0
    let sy = 0
    let count = 0
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = row * width + col
        if (bin[i] === 1 && labels[i] === meta.segment_index) {
          sx += col + 0.5
          sy += row + 0.5
          count++
        }
      }
    }
    if (count === 0) return null
    labelCenters.set(meta.segment_index, [sx / count, sy / count])
  }

  const out = new Map<number, [number, number][]>()
  for (const meta of ordered) {
    const center = labelCenters.get(meta.segment_index) as [number, number]
    const side = line.dx * (center[1] - line.y) - line.dy * (center[0] - line.x)
    if (Math.abs(side) < 1) return null
    const clipped = clipRingToLineHalfPlane(outline, line, side > 0 ? 1 : -1)
    if (clipped.length < 4 || polygonAreaPx(clipped) < MIN_SPLIT_RING_AREA_PX) return null
    out.set(meta.segment_index, clipped)
  }
  return out
}

/**
 * Jointly straighten a small multi-plane partition. Every adjacent pair is clipped by
 * the same fitted boundary, so cleanup cannot create the overlaps produced by
 * simplifying each plane independently. Conservative raster-fidelity gates keep the
 * exact locked contours when the linear model does not match a complex roof.
 */
function multiPlaneLinearizedRings(options: {
  bin: Uint8Array
  labels: Int32Array
  width: number
  height: number
  ordered: SegPx[]
}): Map<number, [number, number][]> | null {
  const { bin, labels, width, height, ordered } = options
  const reject = (reason: string): null => {
    if (process.env.ROOF_MEASURE_DEBUG_LINEARIZE === '1') {
      console.info('[solar-mask] multi-plane linearization rejected', {
        reason,
        plane_count: ordered.length,
      })
    }
    return null
  }
  if (ordered.length < 3 || ordered.length > MAX_FACETS) return reject('plane_count')

  const wholeRing = largestRing(
    contourRingsFromMask(bin, width, height, { smooth: false }).filter(
      (ring) => polygonAreaPx(ring) >= MIN_RING_AREA_PX
    )
  )
  if (!wholeRing) return reject('no_whole_ring')
  const wholeArea = polygonAreaPx(wholeRing)
  if (wholeArea <= 0) return reject('empty_whole_ring')
  const hull = convexHullClosedRing(wholeRing)
  const hullArea = polygonAreaPx(hull)
  const outline = simplifyClosedRing(
    hullArea / wholeArea <= CONVEX_HULL_MAX_INFLATION ? hull : wholeRing,
    SPLIT_RING_SIMPLIFY_EPS_PX,
    MAX_VERTICES_PER_RING
  )
  if (outline.length < 4) return reject('outline_degenerate')

  const centers = new Map<number, [number, number]>()
  const labelCounts = new Map<number, number>()
  const sums = new Map<number, { x: number; y: number }>()
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (bin[i] !== 1) continue
      const label = labels[i]
      if (!ordered.some((meta) => meta.segment_index === label)) continue
      const sum = sums.get(label) ?? { x: 0, y: 0 }
      sum.x += col + 0.5
      sum.y += row + 0.5
      sums.set(label, sum)
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
    }
  }
  for (const meta of ordered) {
    const count = labelCounts.get(meta.segment_index) ?? 0
    const sum = sums.get(meta.segment_index)
    if (!sum || count === 0) return reject(`empty_label_${meta.segment_index}`)
    centers.set(meta.segment_index, [sum.x / count, sum.y / count])
  }

  type SharedLine = { a: number; b: number; line: PixelLine }
  const sharedLines: SharedLine[] = []
  const neighborCounts = new Map<number, number>()
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i].segment_index
      const b = ordered[j].segment_index
      const line = fitTwoPlaneBoundaryLine(bin, labels, width, height, a, b)
      if (!line) continue
      if (line.span < 8 || line.rms > Math.max(4, line.span * 0.16)) {
        return reject(`nonlinear_boundary_${a}_${b}_span_${line.span.toFixed(1)}_rms_${line.rms.toFixed(1)}`)
      }
      const aCenter = centers.get(a) as [number, number]
      const bCenter = centers.get(b) as [number, number]
      const aSide = line.dx * (aCenter[1] - line.y) - line.dy * (aCenter[0] - line.x)
      const bSide = line.dx * (bCenter[1] - line.y) - line.dy * (bCenter[0] - line.x)
      if (Math.abs(aSide) < 1 || Math.abs(bSide) < 1 || aSide * bSide >= 0) {
        return reject(`boundary_does_not_separate_${a}_${b}`)
      }
      sharedLines.push({ a, b, line })
      neighborCounts.set(a, (neighborCounts.get(a) ?? 0) + 1)
      neighborCounts.set(b, (neighborCounts.get(b) ?? 0) + 1)
    }
  }
  if (sharedLines.length < ordered.length - 1) return reject('disconnected_boundary_graph')
  if (ordered.some((meta) => (neighborCounts.get(meta.segment_index) ?? 0) === 0)) {
    return reject('plane_without_neighbor')
  }

  const candidates = new Map<number, [number, number][]>()
  for (const meta of ordered) {
    const label = meta.segment_index
    const center = centers.get(label) as [number, number]
    let ring = outline
    for (const shared of sharedLines) {
      if (shared.a !== label && shared.b !== label) continue
      const side =
        shared.line.dx * (center[1] - shared.line.y) -
        shared.line.dy * (center[0] - shared.line.x)
      ring = clipRingToLineHalfPlane(ring, shared.line, side > 0 ? 1 : -1)
      if (ring.length < 4) return reject(`clip_degenerate_${label}`)
    }
    if (polygonAreaPx(ring) < MIN_SPLIT_RING_AREA_PX) return reject(`clip_too_small_${label}`)
    candidates.set(label, ring)
  }

  const candidateMasks = new Map<number, Uint8Array>()
  const roofPixels = bin.reduce((sum, value) => sum + (value === 1 ? 1 : 0), 0)
  if (roofPixels === 0) return reject('empty_roof_mask')
  let predictedTotal = 0
  for (const meta of ordered) {
    const label = meta.segment_index
    const mask = rasterizeClosedRingToMask(
      candidates.get(label) as [number, number][],
      width,
      height
    )
    candidateMasks.set(label, mask)
    let predicted = 0
    let correct = 0
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 1) continue
      predicted++
      if (bin[i] === 1 && labels[i] === label) correct++
    }
    const actual = labelCounts.get(label) as number
    const labelFraction = actual / roofPixels
    const minPrecision = labelFraction < 0.12 ? 0.48 : 0.5
    const minRecall = labelFraction < 0.12 ? 0.7 : 0.55
    if (predicted === 0 || correct / predicted < minPrecision || correct / actual < minRecall) {
      return reject(
        `fidelity_${label}_precision_${(correct / Math.max(1, predicted)).toFixed(2)}_recall_${(correct / actual).toFixed(2)}`
      )
    }
    predictedTotal += predicted
  }
  if (predictedTotal / roofPixels < 0.78 || predictedTotal / roofPixels > 1.12) {
    return reject(`total_coverage_${(predictedTotal / roofPixels).toFixed(2)}`)
  }
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const aMask = candidateMasks.get(ordered[i].segment_index) as Uint8Array
      const bMask = candidateMasks.get(ordered[j].segment_index) as Uint8Array
      for (let k = 0; k < aMask.length; k++) {
        if (aMask[k] === 1 && bMask[k] === 1) return reject('candidate_pixel_overlap')
      }
    }
  }
  return candidates
}

function pixelPointKey(point: [number, number]): string {
  return `${point[0].toFixed(4)},${point[1].toFixed(4)}`
}

function pixelEdgeKey(a: [number, number], b: [number, number]): string {
  const ak = pixelPointKey(a)
  const bk = pixelPointKey(b)
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`
}

/** Simplify a closed ring while forcing shared-arc endpoints/junctions to remain. */
function simplifyRingBetweenAnchors(
  ring: [number, number][],
  anchorKeys: Set<string>,
  epsilon: number
): [number, number][] {
  const points = openRingPoints(ring)
  if (points.length < 4) return closeRing(points)
  const anchors = points
    .map((point, index) => (anchorKeys.has(pixelPointKey(point)) ? index : -1))
    .filter((index) => index >= 0)
  if (anchors.length < 2) return simplifyClosedRing(ring, epsilon, MAX_VERTICES_PER_SPLIT_RING)

  const out: [number, number][] = []
  for (let a = 0; a < anchors.length; a++) {
    const start = anchors[a]
    const end = anchors[(a + 1) % anchors.length]
    const path: [number, number][] = [points[start]]
    let index = start
    while (index !== end) {
      index = (index + 1) % points.length
      path.push(points[index])
    }
    const simplified = douglasPeucker(path, epsilon)
    if (out.length === 0) out.push(...simplified)
    else out.push(...simplified.slice(1))
  }
  if (out.length > 1 && pixelPointKey(out[0]) === pixelPointKey(out[out.length - 1])) out.pop()
  return closeRing(out)
}

/**
 * Topology-preserving fallback for Parks-class roofs. Shared raster edges form finite
 * graph arcs; degree-1 endpoints and degree-3+ junctions are locked, then every ring is
 * simplified only between those anchors. Raster overlap validation remains authoritative;
 * the downstream weld brings near-coincident junction endpoints onto one shared node.
 */
export function topologySimplifiedRings(options: {
  bin: Uint8Array
  labels: Int32Array
  width: number
  height: number
  ordered: SegPx[]
}): Map<number, [number, number][]> | null {
  const { bin, labels, width, height, ordered } = options
  const reject = (reason: string): null => {
    if (process.env.ROOF_MEASURE_DEBUG_LINEARIZE === '1') {
      console.info('[solar-mask] topology simplification rejected', {
        reason,
        plane_count: ordered.length,
      })
    }
    return null
  }
  if (ordered.length < 2 || ordered.length > MAX_FACETS) return reject('plane_count')
  const scratch = new Float64Array(width * height)
  const temp = new Uint8Array(width * height)
  const locked = new Uint8Array(width * height)
  const exact = new Map<number, [number, number][]>()
  const exactMasks = new Map<number, Uint8Array>()

  for (const meta of ordered) {
    scratch.fill(0)
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === meta.segment_index && bin[i] === 1) scratch[i] = 1
    }
    const ring = largestRing(
      contourRingsFromMask(scratch, width, height, { smooth: false }).filter(
        (candidate) => polygonAreaPx(candidate) >= MIN_SPLIT_RING_AREA_PX
      )
    )
    if (!ring) return reject(`missing_source_ring_${meta.segment_index}`)
    const ringArea = polygonAreaPx(ring)
    const hull = convexHullClosedRing(ring)
    const regularized =
      ringArea > 0 && polygonAreaPx(hull) / ringArea <= CONVEX_HULL_MAX_INFLATION ? hull : ring
    const simplified = removeSpikeVertices(
      simplifyClosedRing(regularized, SPLIT_RING_SIMPLIFY_EPS_PX, MAX_VERTICES_PER_SPLIT_RING),
      SPLIT_RING_SPIKE_MIN_ANGLE_DEG
    )
    rasterizeClosedRingToMask(simplified, width, height, temp)
    locked.fill(0)
    for (let i = 0; i < labels.length; i++) {
      if (temp[i] === 1 && scratch[i] === 1) locked[i] = 1
    }
    const lockedRing = largestRing(
      contourRingsFromMask(locked, width, height, { smooth: false }).filter(
        (candidate) => polygonAreaPx(candidate) >= MIN_SPLIT_RING_AREA_PX
      )
    )
    if (!lockedRing) return reject(`missing_locked_ring_${meta.segment_index}`)
    exact.set(meta.segment_index, lockedRing)
    exactMasks.set(meta.segment_index, rasterizeClosedRingToMask(lockedRing, width, height))
  }

  const edgeCounts = new Map<string, number>()
  for (const ring of Array.from(exact.values())) {
    const points = openRingPoints(ring)
    for (let i = 0; i < points.length; i++) {
      const key = pixelEdgeKey(points[i], points[(i + 1) % points.length])
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
    }
  }
  const sharedAdjacency = new Map<string, Set<string>>()
  for (const ring of Array.from(exact.values())) {
    const points = openRingPoints(ring)
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      if ((edgeCounts.get(pixelEdgeKey(a, b)) ?? 0) < 2) continue
      const ak = pixelPointKey(a)
      const bk = pixelPointKey(b)
      const an = sharedAdjacency.get(ak) ?? new Set<string>()
      const bn = sharedAdjacency.get(bk) ?? new Set<string>()
      an.add(bk)
      bn.add(ak)
      sharedAdjacency.set(ak, an)
      sharedAdjacency.set(bk, bn)
    }
  }
  if (sharedAdjacency.size === 0) return reject('no_shared_edges')
  const anchorKeys = new Set<string>()
  for (const [key, neighbors] of Array.from(sharedAdjacency.entries())) {
    if (neighbors.size !== 2) anchorKeys.add(key)
  }
  // Closed shared loops have no natural endpoint; preserve two well-separated nodes.
  if (anchorKeys.size < 2) {
    const keys = Array.from(sharedAdjacency.keys())
    if (keys.length >= 2) {
      anchorKeys.add(keys[0])
      anchorKeys.add(keys[Math.floor(keys.length / 2)])
    }
  }

  const candidates = new Map<number, [number, number][]>()
  for (const meta of ordered) {
    const ring = exact.get(meta.segment_index) as [number, number][]
    // The ring is already exclusivity-locked. Keep this cleanup at <= 1 px so
    // finite shared arcs cannot cut materially across a plane interior.
    const simplified = simplifyRingBetweenAnchors(ring, anchorKeys, 1)
    if (
      simplified.length < 4 ||
      simplified.length - 1 > MAX_VERTICES_PER_SPLIT_RING ||
      polygonAreaPx(simplified) < MIN_SPLIT_RING_AREA_PX
    ) {
      return reject(`candidate_geometry_${meta.segment_index}_${simplified.length - 1}`)
    }
    candidates.set(meta.segment_index, simplified)
  }

  const masks = new Map<number, Uint8Array>()
  let predictedTotal = 0
  let exactTotal = 0
  for (const meta of ordered) {
    const label = meta.segment_index
    const mask = rasterizeClosedRingToMask(
      candidates.get(label) as [number, number][],
      width,
      height
    )
    masks.set(label, mask)
    let actual = 0
    let predicted = 0
    let correct = 0
    const exactMask = exactMasks.get(label) as Uint8Array
    for (let i = 0; i < mask.length; i++) {
      if (exactMask[i] === 1) {
        actual++
        exactTotal++
      }
      if (mask[i] === 1) {
        predicted++
        if (exactMask[i] === 1) correct++
      }
    }
    if (
      actual === 0 ||
      predicted === 0 ||
      correct / predicted < 0.9 ||
      correct / actual < 0.9
    ) {
      return reject(
        `fidelity_${label}_p${predicted === 0 ? 0 : (correct / predicted).toFixed(3)}_r${
          actual === 0 ? 0 : (correct / actual).toFixed(3)
        }`
      )
    }
    predictedTotal += predicted
  }
  // This stage only changes representation of the already exclusive contours.
  // Whole-roof coverage remains owned by the unchanged strict/relaxed selector.
  if (exactTotal === 0 || predictedTotal / exactTotal < 0.94 || predictedTotal / exactTotal > 1.06) {
    return reject(`locked_coverage_${(predictedTotal / exactTotal).toFixed(3)}`)
  }
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = masks.get(ordered[i].segment_index) as Uint8Array
      const b = masks.get(ordered[j].segment_index) as Uint8Array
      for (let k = 0; k < a.length; k++) {
        if (a[k] === 1 && b[k] === 1) return reject(`pixel_overlap_${i}_${j}`)
      }
    }
  }
  return candidates
}

/**
 * Finite planar-partition simplification for Village/Greenway-class roofs where the per-ring
 * {@link topologySimplifiedRings} rejects (curled contours over the 72-vertex cap). Instead of
 * simplifying each plane ring independently, this treats the exclusive raster boundary as a
 * shared graph: every boundary run between junction/endpoint anchors is a finite arc, simplified
 * exactly ONCE and reused (reversed) by both owning planes. Shared interior arcs keep a tight
 * epsilon (fidelity); exterior roof-outline arcs decimate at the normal epsilon. Junction
 * coordinates are therefore identical across owners by construction, so facets meet exactly — no
 * gaps, no overlap. Same authoritative fidelity / coverage / raster-overlap gates as
 * topologySimplifiedRings; any failure returns null so the caller fails closed to bbox/manual.
 *
 * Stages 1, 2 and 4 mirror topologySimplifiedRings (dedupe into a shared helper once this method
 * is promoted ahead of the per-ring path); only stage 3 (per-arc simplification) is new.
 */
export function topologyPartitionRings(options: {
  bin: Uint8Array
  labels: Int32Array
  width: number
  height: number
  ordered: SegPx[]
}): Map<number, [number, number][]> | null {
  const { bin, labels, width, height, ordered } = options
  const INTERIOR_ARC_EPS_PX = 1.5
  const EXTERIOR_ARC_EPS_PX = SPLIT_RING_SIMPLIFY_EPS_PX
  const reject = (reason: string): null => {
    if (process.env.ROOF_MEASURE_DEBUG_LINEARIZE === '1') {
      console.info('[solar-mask] topology partition rejected', { reason, plane_count: ordered.length })
    }
    return null
  }
  if (ordered.length < 2 || ordered.length > MAX_FACETS) return reject('plane_count')

  // --- Stage 1: exclusive-locked exact ring per plane (mirrors topologySimplifiedRings). ---
  const scratch = new Float64Array(width * height)
  const temp = new Uint8Array(width * height)
  const locked = new Uint8Array(width * height)
  const exact = new Map<number, [number, number][]>()
  const exactMasks = new Map<number, Uint8Array>()
  for (const meta of ordered) {
    scratch.fill(0)
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === meta.segment_index && bin[i] === 1) scratch[i] = 1
    }
    const ring = largestRing(
      contourRingsFromMask(scratch, width, height, { smooth: false }).filter(
        (candidate) => polygonAreaPx(candidate) >= MIN_SPLIT_RING_AREA_PX
      )
    )
    if (!ring) return reject(`missing_source_ring_${meta.segment_index}`)
    const ringArea = polygonAreaPx(ring)
    const hull = convexHullClosedRing(ring)
    const regularized =
      ringArea > 0 && polygonAreaPx(hull) / ringArea <= CONVEX_HULL_MAX_INFLATION ? hull : ring
    const simplified = removeSpikeVertices(
      simplifyClosedRing(regularized, SPLIT_RING_SIMPLIFY_EPS_PX, MAX_VERTICES_PER_SPLIT_RING),
      SPLIT_RING_SPIKE_MIN_ANGLE_DEG
    )
    rasterizeClosedRingToMask(simplified, width, height, temp)
    locked.fill(0)
    for (let i = 0; i < labels.length; i++) {
      if (temp[i] === 1 && scratch[i] === 1) locked[i] = 1
    }
    const lockedRing = largestRing(
      contourRingsFromMask(locked, width, height, { smooth: false }).filter(
        (candidate) => polygonAreaPx(candidate) >= MIN_SPLIT_RING_AREA_PX
      )
    )
    if (!lockedRing) return reject(`missing_locked_ring_${meta.segment_index}`)
    exact.set(meta.segment_index, lockedRing)
    exactMasks.set(meta.segment_index, rasterizeClosedRingToMask(lockedRing, width, height))
  }

  // --- Stage 2: shared-edge graph + anchor (junction/endpoint) nodes. ---
  const edgeCounts = new Map<string, number>()
  for (const ring of Array.from(exact.values())) {
    const points = openRingPoints(ring)
    for (let i = 0; i < points.length; i++) {
      const key = pixelEdgeKey(points[i], points[(i + 1) % points.length])
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
    }
  }
  const sharedAdjacency = new Map<string, Set<string>>()
  for (const ring of Array.from(exact.values())) {
    const points = openRingPoints(ring)
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      if ((edgeCounts.get(pixelEdgeKey(a, b)) ?? 0) < 2) continue
      const ak = pixelPointKey(a)
      const bk = pixelPointKey(b)
      const an = sharedAdjacency.get(ak) ?? new Set<string>()
      const bn = sharedAdjacency.get(bk) ?? new Set<string>()
      an.add(bk)
      bn.add(ak)
      sharedAdjacency.set(ak, an)
      sharedAdjacency.set(bk, bn)
    }
  }
  if (sharedAdjacency.size === 0) return reject('no_shared_edges')
  const anchorKeys = new Set<string>()
  for (const [key, neighbors] of Array.from(sharedAdjacency.entries())) {
    if (neighbors.size !== 2) anchorKeys.add(key)
  }
  if (anchorKeys.size < 2) {
    const keys = Array.from(sharedAdjacency.keys())
    if (keys.length >= 2) {
      anchorKeys.add(keys[0])
      anchorKeys.add(keys[Math.floor(keys.length / 2)])
    }
  }

  // --- Stage 3 (new): simplify each finite arc ONCE, direction-canonical so both owners of a
  //     shared arc reuse identical vertices. ---
  const isSharedEdge = (a: [number, number], b: [number, number]): boolean =>
    (edgeCounts.get(pixelEdgeKey(a, b)) ?? 0) >= 2
  const arcCache = new Map<string, [number, number][]>()
  const simplifyArc = (path: [number, number][]): [number, number][] => {
    if (path.length < 3) return path
    const startK = pixelPointKey(path[0])
    const endK = pixelPointKey(path[path.length - 1])
    const forward = startK <= endK
    const canonInput = forward ? path : path.slice().reverse()
    const key = canonInput.map((p) => pixelPointKey(p)).join(';')
    let canon = arcCache.get(key)
    if (!canon) {
      const shared = isSharedEdge(path[0], path[1])
      canon = douglasPeucker(canonInput, shared ? INTERIOR_ARC_EPS_PX : EXTERIOR_ARC_EPS_PX)
      arcCache.set(key, canon)
    }
    return forward ? canon : canon.slice().reverse()
  }

  const candidates = new Map<number, [number, number][]>()
  for (const meta of ordered) {
    const ring = exact.get(meta.segment_index) as [number, number][]
    const points = openRingPoints(ring)
    const anchors = points
      .map((p, i) => (anchorKeys.has(pixelPointKey(p)) ? i : -1))
      .filter((i) => i >= 0)
    let rebuilt: [number, number][]
    if (anchors.length < 2) {
      // No shared boundary on this ring — decimate as a standalone exterior outline.
      rebuilt = simplifyClosedRing(ring, EXTERIOR_ARC_EPS_PX, MAX_VERTICES_PER_SPLIT_RING)
    } else {
      const out: [number, number][] = []
      for (let a = 0; a < anchors.length; a++) {
        const start = anchors[a]
        const end = anchors[(a + 1) % anchors.length]
        const arcPath: [number, number][] = [points[start]]
        let index = start
        while (index !== end) {
          index = (index + 1) % points.length
          arcPath.push(points[index])
        }
        const simp = simplifyArc(arcPath)
        if (out.length === 0) out.push(...simp)
        else out.push(...simp.slice(1))
      }
      if (out.length > 1 && pixelPointKey(out[0]) === pixelPointKey(out[out.length - 1])) out.pop()
      rebuilt = closeRing(out)
    }
    if (
      rebuilt.length < 4 ||
      rebuilt.length - 1 > MAX_VERTICES_PER_SPLIT_RING ||
      polygonAreaPx(rebuilt) < MIN_SPLIT_RING_AREA_PX
    ) {
      return reject(`candidate_geometry_${meta.segment_index}_${rebuilt.length - 1}`)
    }
    candidates.set(meta.segment_index, rebuilt)
  }

  // --- Stage 4: authoritative fidelity / coverage / raster-overlap gates (as
  //     topologySimplifiedRings). Any failure fails closed. ---
  const masks = new Map<number, Uint8Array>()
  let predictedTotal = 0
  let exactTotal = 0
  for (const meta of ordered) {
    const label = meta.segment_index
    const mask = rasterizeClosedRingToMask(candidates.get(label) as [number, number][], width, height)
    masks.set(label, mask)
    let actual = 0
    let predicted = 0
    let correct = 0
    const exactMask = exactMasks.get(label) as Uint8Array
    for (let i = 0; i < mask.length; i++) {
      if (exactMask[i] === 1) {
        actual++
        exactTotal++
      }
      if (mask[i] === 1) {
        predicted++
        if (exactMask[i] === 1) correct++
      }
    }
    if (actual === 0 || predicted === 0 || correct / predicted < 0.9 || correct / actual < 0.9) {
      return reject(
        `fidelity_${label}_p${predicted === 0 ? 0 : (correct / predicted).toFixed(3)}_r${
          actual === 0 ? 0 : (correct / actual).toFixed(3)
        }`
      )
    }
    predictedTotal += predicted
  }
  if (exactTotal === 0 || predictedTotal / exactTotal < 0.94 || predictedTotal / exactTotal > 1.06) {
    return reject(`locked_coverage_${(predictedTotal / exactTotal).toFixed(3)}`)
  }
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = masks.get(ordered[i].segment_index) as Uint8Array
      const b = masks.get(ordered[j].segment_index) as Uint8Array
      for (let k = 0; k < a.length; k++) {
        if (a[k] === 1 && b[k] === 1) return reject(`pixel_overlap_${i}_${j}`)
      }
    }
  }
  return candidates
}

/** Drop consecutive duplicate vertices left after welding (zero-length edges). */
function dedupeConsecutiveVertices(
  vertices: { lat: number; lng: number }[]
): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = []
  for (const p of vertices) {
    const prev = out[out.length - 1]
    if (prev && prev.lat === p.lat && prev.lng === p.lng) continue
    out.push(p)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && first.lat === last.lat && first.lng === last.lng) out.pop()
  return out
}

/**
 * Weld near-coincident vertices belonging to DIFFERENT facets to a shared point, so
 * adjacent planes meet at coincident junction vertices — closing the small gaps/overlaps
 * and starburst pinches left by independently-contoured planes, and giving shared ridges
 * coincident endpoints. Vertices within the same facet are never merged. Areas are
 * recomputed afterward since the outline shifts slightly.
 */
function weldSharedFacetVertices(facets: SolarMaskFacetPayload[], snapMeters: number): void {
  type WeldNode = { f: number; v: number; lat: number; lng: number }
  const nodes: WeldNode[] = []
  facets.forEach((facet, f) =>
    facet.lat_lng_vertices.forEach((p, v) => nodes.push({ f, v, lat: p.lat, lng: p.lng }))
  )
  const parent = nodes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].f === nodes[j].f) continue
      if (distanceMeters(nodes[i], nodes[j]) <= snapMeters) {
        const ra = find(i)
        const rb = find(j)
        if (ra !== rb) parent[ra] = rb
      }
    }
  }
  const clusters = new Map<number, WeldNode[]>()
  for (let i = 0; i < nodes.length; i++) {
    const root = find(i)
    const list = clusters.get(root)
    if (list) list.push(nodes[i])
    else clusters.set(root, [nodes[i]])
  }
  for (const members of Array.from(clusters.values())) {
    if (members.length < 2) continue
    // Union-find proximity is transitive: A-B and B-C may be within the snap radius
    // while A-C is much farther away. Never apply such a chained weld, and never let
    // a chain indirectly collapse two different vertices from the same facet.
    if (new Set(members.map((member) => member.f)).size !== members.length) continue
    let bounded = true
    for (let i = 0; i < members.length && bounded; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (distanceMeters(members[i], members[j]) > snapMeters) {
          bounded = false
          break
        }
      }
    }
    if (!bounded) continue
    const lat = members.reduce((s: number, n: WeldNode) => s + n.lat, 0) / members.length
    const lng = members.reduce((s: number, n: WeldNode) => s + n.lng, 0) / members.length
    for (const n of members) facets[n.f].lat_lng_vertices[n.v] = { lat, lng }
  }
  for (const facet of facets) {
    facet.lat_lng_vertices = dedupeConsecutiveVertices(facet.lat_lng_vertices)
    const area = Math.round(planarPolygonAreaSqFt(facet.lat_lng_vertices))
    facet.estimated_sq_ft = area > 0 ? area : null
  }
  // Drop any facet welding collapsed below a valid polygon so degenerate rings
  // never reach downstream centroid/area math.
  for (let i = facets.length - 1; i >= 0; i--) {
    if (facets[i].lat_lng_vertices.length < 3) facets.splice(i, 1)
  }
}

/** Drop the smaller plane whenever welding reintroduces interior overlap. */
function dropInteriorOverlappingPlanes(facets: SolarMaskFacetPayload[]): void {
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < facets.length; i++) {
      for (let j = i + 1; j < facets.length; j++) {
        if (!polygonsOverlapInterior(facets[i].lat_lng_vertices, facets[j].lat_lng_vertices)) continue
        const dropIdx =
          splitPlaneFootprintSqft(facets[i]) >= splitPlaneFootprintSqft(facets[j]) ? j : i
        facets.splice(dropIdx, 1)
        changed = true
        break
      }
      if (changed) break
    }
  }
}

/** Exported for unit tests — per-segment mask split with exclusive plane locking. */
export function facetsFromSplitMask(options: {
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
  const temp = new Uint8Array(width * height)
  const locked = new Uint8Array(width * height)
  const out: SolarMaskFacetPayload[] = []

  const ordered = [...segsPx].sort((a, b) => a.segment_index - b.segment_index)
  const regularizedRings =
    simpleTwoPlaneGableRings({ bin, labels, width, height, ordered }) ??
    multiPlaneLinearizedRings({ bin, labels, width, height, ordered }) ??
    topologySimplifiedRings({ bin, labels, width, height, ordered }) ??
    topologyPartitionRings({ bin, labels, width, height, ordered })
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
    // Regularize toward a clean outline, but never fill a real concavity: accept the
    // convex hull only when it barely changes area (plane already ~convex). Concave
    // planes (L-shapes, valley edges, dormer cut-ins) keep their partition-following
    // contour so areas stay accurate and neighbors don't overlap.
    const ringArea = polygonAreaPx(ring)
    const hull = convexHullClosedRing(ring)
    const hullArea = polygonAreaPx(hull)
    const regularizedRing =
      ringArea > 0 && hullArea / ringArea <= CONVEX_HULL_MAX_INFLATION ? hull : ring
    const simplified = removeSpikeVertices(
      simplifyClosedRing(regularizedRing, SPLIT_RING_SIMPLIFY_EPS_PX, MAX_VERTICES_PER_SPLIT_RING),
      SPLIT_RING_SPIKE_MIN_ANGLE_DEG
    )
    if (simplified.length < 4) continue

    // Exclusivity lock: clip the simplified outline back to this plane's label pixels.
    rasterizeClosedRingToMask(simplified, width, height, temp)
    locked.fill(0)
    for (let i = 0; i < labels.length; i++) {
      if (temp[i] === 1 && scratch[i] === 1) locked[i] = 1
    }
    const lockedRings = contourRingsFromMask(locked, width, height, { smooth: false }).filter(
      (r) => polygonAreaPx(r) >= MIN_SPLIT_RING_AREA_PX
    )
    const lockedRing = largestRing(lockedRings)
    if (!lockedRing) continue

    // Keep the exact locked contour. Simplification, spike removal, and vertex-count
    // decimation can all chord across a concavity and recreate overlap after the lock.
    const cleaned = regularizedRings?.get(meta.segment_index) ?? lockedRing
    if (cleaned.length < 4) continue

    const latLngVertices: { lat: number; lng: number }[] = []
    for (let i = 0; i < cleaned.length - 1; i++) {
      const [x, y] = cleaned[i]
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
  /** buildingInsights.center — single seed for whole-roof contour isolation. */
  buildingCenter?: { lat: number; lng: number } | null
  /** Optional label for diagnostics (e.g. requested_pin vs solar_anchor). */
  querySource?: string
}): Promise<SolarMaskAttemptResult> {
  const { lat, lng, apiKey, referenceLat, referenceLng, segments, buildingCenter, querySource } =
    options
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
    // Ridge/peak segments are dropped as plane targets but their pixels are KEPT (unlike
    // accessories): they belong to the two slopes, which meet at the ridge once the flat
    // peak plane is not a label target.
    const ridgePeakIndices = ridgePeakSegmentIndices(segments)
    const activeSegments = segments.filter(
      (segment) =>
        !excludedAccessoryIndices.has(segment.segment_index) &&
        !ridgePeakIndices.has(segment.segment_index)
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
      const splitBin = workBin
      if (dsmSampler && planes.length >= 2) {
        // Label the connected satellite mask directly and keep every in-mask pixel.
        // Expanding to Solar segment bboxes + height-clipping inflated real planes and
        // dropped valid noisy-DSM roof; the DSM is still used to CHOOSE each pixel's
        // plane, so boundaries follow real ridges without changing total coverage.
        // Excluded accessory roofs are already removed from workBin upstream.
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
      weldSharedFacetVertices(splitOut, SHARED_VERTEX_WELD_METERS)
      dropInteriorOverlappingPlanes(splitOut)
      const targetMaskFootprintSqft = rasterMaskFootprintSqft(
        splitBin,
        width,
        height,
        pixelToLngLat
      )
      const usableSplit = selectUsableSplitFacets(
        splitOut,
        targetMaskFootprintSqft ?? undefined
      )
      if (usableSplit && mergedPlanesFailPitchHomogeneity(mergedSegments)) {
        console.info('[solar-mask] pitch homogeneity rejected; fail closed', {
          ...baseDetails,
          split_plane_count: usableSplit.facets.length,
          merged_segment_count: mergedSegments.length,
          max_pitch_dev_deg: MAX_MERGED_PLANE_PITCH_DEV_DEG,
        })
        return maskAttempt('split_quality_below_threshold', null, {
          ...baseDetails,
          mask_width: width,
          mask_height: height,
          split_plane_count: usableSplit.facets.length,
          merged_segment_count: mergedSegments.length,
          path: 'pitch_homogeneity_reject',
          split_method: splitMethod,
        })
      }
      if (usableSplit) {
        const overlapDiag = explainSplitQualityRejection(
          usableSplit.facets,
          targetMaskFootprintSqft ?? undefined
        )
        return maskAttempt('ok', usableSplit.facets, {
          ...baseDetails,
          mask_width: width,
          mask_height: height,
          split_plane_count: usableSplit.facets.length,
          merged_segment_count: mergedSegments.length,
          excluded_accessory_segment_count: excludedAccessoryIndices.size,
          target_mask_footprint_sqft:
            targetMaskFootprintSqft == null ? null : Math.round(targetMaskFootprintSqft),
          overlapping_pairs: overlapDiag.overlapping_pairs,
          path:
            usableSplit.mode === 'strict'
              ? 'split_mask_plane'
              : usableSplit.mode === 'pruned'
                ? 'split_mask_plane_pruned'
                : usableSplit.mode === 'nonoverlap'
                  ? 'split_mask_plane_nonoverlap'
                  : 'split_mask_plane_relaxed',
          split_method: splitMethod,
          split_quality_mode: usableSplit.mode,
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
      } else if (splitOut.length > MAX_FACETS) {
        // Over-segmented after consolidation (too many planes to ship as a clean split). Fall
        // through to the whole-mask contour — a clean outline + robust full-coverage total — in
        // preference to a rough Solar bbox. The save gate still requires a rep to split faces
        // before the whole-mask geometry becomes order-ready.
        console.info('[solar-mask] split plane count exceeds max; whole-roof fallback', {
          ...baseDetails,
          split_filtered_count: splitOut.length,
          max_facets: MAX_FACETS,
          merged_segment_count: mergedSegments.length,
        })
      } else if (splitOut.length > 0) {
        const maxSqft = Math.max(
          ...splitOut.map((f) => f.estimated_sq_ft ?? planarPolygonAreaSqFt(f.lat_lng_vertices))
        )
        console.info('[solar-mask] split planes below quality threshold; whole-roof fallback', {
          ...baseDetails,
          split_filtered_count: splitOut.length,
          max_plane_sqft: maxSqft,
          min_required_sqft: MIN_PLANE_FOOTPRINT_SQFT,
          ...explainSplitQualityRejection(splitOut, targetMaskFootprintSqft ?? undefined),
        })
      }
    }

    // Whole-roof contour. When buildingInsights center is provided (topology capture),
    // flood-fill from it only so a multi-segment seed set cannot bridge onto a
    // neighbor/garage roof pixel. When omitted (live detect-roof), preserve prior
    // behavior exactly: contour the full work mask with no seed restriction.
    let wholeContourBin = workBin
    if (buildingCenter) {
      const bcPx = lngLatToColRow(buildingCenter.lat, buildingCenter.lng)
      if (bcPx) {
        wholeContourBin = restrictMaskToSeedComponent(workBin, width, height, [bcPx]) ?? workBin
      }
    }

    let rings = contourRingsFromMask(wholeContourBin, width, height)
    rings = rings.filter((r) => polygonAreaPx(r) >= MIN_RING_AREA_PX)

    if (rings.length === 0) {
      return maskAttempt('no_roof_pixels', null, {
        ...baseDetails,
        mask_width: width,
        mask_height: height,
        contour_rings: 0,
      })
    }

    const wholeContourRef = buildingCenter ?? ref
    const wholeContourRefPx = buildingCenter
      ? lngLatToColRow(buildingCenter.lat, buildingCenter.lng)
      : refPx

    const scoreRing = (ring: [number, number][]) => {
      const [cx, cy] = ringCentroid(ring)
      const cLngLat = pixelToLngLat(cx, cy)
      const containsPin =
        wholeContourRefPx != null
          ? pointInPolygonColRow(wholeContourRefPx.col, wholeContourRefPx.row, ring)
          : false
      const dist = distanceMeters(wholeContourRef, cLngLat)
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
