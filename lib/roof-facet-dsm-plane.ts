/**
 * Fit a real roof plane to each drawn facet from the Google Solar DSM.
 *
 * Why: ~88% of facets saved in the last 90 days are hand-drawn, and their drain
 * direction came from `computeFacetDrainAzimuth` — a guess from the polygon's
 * shape. Every ridge/hip/valley and eave/rake call hangs off that direction, so
 * the guess is where the ridge/hip split errors come from (auto ridge read
 * 25–97% low on every carrier-scored job, 2026-09-25 audit).
 *
 * The old DSM pitch (`pitchDegreesFromDsmHeights`) used only the vertex heights,
 * which sit on the noisiest part of a roof (eaves, ridges, neighbor bleed). This
 * samples a grid INSIDE the facet, inset from its edges, and least-squares fits
 * z = a·x + b·y + c with outlier rejection — hundreds of samples instead of 4–6.
 *
 * Pure: takes a height sampler so it can be tested without a GeoTIFF.
 *
 * NOT WIRED INTO THE LIVE TOOL (2026-09-26). Scored on 10 carrier jobs with
 * `npm run roof-measure:dsm-eval`: DSM drain direction cut ridge error 61% → 44%
 * (→ 30% with T-junction splitting) but made ridge+hip cap error worse (21% → 25–35%),
 * and fit only ~half the facets on some roofs (BASE-quality DSM). Mixed results on
 * money numbers don't ship. Re-run the eval before wiring any of this in.
 */
import type { RoofMeasurePoint } from './roof-measure-geometry'

export type HeightSampler = (lat: number, lng: number) => number | null

export type FacetDsmPlane = {
  /** Compass bearing water flows toward (0 = N, 90 = E). Null when the plane is ~flat. */
  drainAzimuthDegrees: number | null
  pitchDegrees: number
  /** Plane height (m, DSM datum) at the facet's vertex centroid. */
  heightAtCentroidM: number
  /** Least-squares plane in local meters around `origin` (x = east, y = north). */
  a: number
  b: number
  c: number
  origin: RoofMeasurePoint
  samples: number
  rmseM: number
}

const M_PER_DEG_LAT = 111_320

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

type XY = { x: number; y: number }

function toLocal(p: RoofMeasurePoint, origin: RoofMeasurePoint): XY {
  return { x: (p.lng - origin.lng) * mPerDegLng(origin.lat), y: (p.lat - origin.lat) * M_PER_DEG_LAT }
}

function toLatLng(q: XY, origin: RoofMeasurePoint): RoofMeasurePoint {
  return { lat: origin.lat + q.y / M_PER_DEG_LAT, lng: origin.lng + q.x / mPerDegLng(origin.lat) }
}

function pointInPolygon(q: XY, poly: XY[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distToSegment(q: XY, a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy))
}

function distToBoundary(q: XY, poly: XY[]): number {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(q, poly[i], poly[(i + 1) % poly.length]))
  return d
}

function solve3(m: number[][], v: number[]): [number, number, number] | null {
  const det = (A: number[][]) =>
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  const d = det(m)
  if (Math.abs(d) < 1e-9) return null
  const col = (k: number) => m.map((row, r) => row.map((val, c) => (c === k ? v[r] : val)))
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d]
}

function fitPlane(pts: { x: number; y: number; z: number }[]): [number, number, number] | null {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxz = 0, syz = 0, sz = 0
  for (const p of pts) {
    sxx += p.x * p.x; sxy += p.x * p.y; sx += p.x
    syy += p.y * p.y; sy += p.y; n += 1
    sxz += p.x * p.z; syz += p.y * p.z; sz += p.z
  }
  return solve3(
    [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]],
    [sxz, syz, sz]
  )
}

function median(xs: number[]): number {
  const s = [...xs].sort((p, q) => p - q)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Below this the plane is effectively flat and has no meaningful drain direction. */
export const DSM_PLANE_FLAT_PITCH_DEG = 3
/** A fit this rough is not a single plane (the facet spans a ridge, a tree, or a neighbor). */
export const DSM_PLANE_MAX_RMSE_M = 0.35
export const DSM_PLANE_MIN_SAMPLES = 25

/**
 * Fit the facet's plane from DSM samples on a grid inside the polygon.
 * Returns null when there isn't enough clean roof inside the facet to trust a fit.
 */
export function fitFacetPlaneFromDsm(
  points: RoofMeasurePoint[],
  sampleHeight: HeightSampler,
  opts: { gridM?: number; insetM?: number } = {}
): FacetDsmPlane | null {
  if (points.length < 3) return null
  const origin = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  }
  const poly = points.map((p) => toLocal(p, origin))
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const grid = opts.gridM ?? 0.3

  const collect = (inset: number) => {
    const out: { x: number; y: number; z: number }[] = []
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += grid) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += grid) {
        const q = { x, y }
        if (!pointInPolygon(q, poly)) continue
        if (inset > 0 && distToBoundary(q, poly) < inset) continue
        const ll = toLatLng(q, origin)
        const z = sampleHeight(ll.lat, ll.lng)
        if (z != null && Number.isFinite(z)) out.push({ x, y, z })
      }
    }
    return out
  }

  // Keep off the edges (eave overhang, ridge rounding, neighbor bleed); relax on small facets.
  let pts = collect(opts.insetM ?? 0.6)
  if (pts.length < DSM_PLANE_MIN_SAMPLES) pts = collect(0.25)
  if (pts.length < DSM_PLANE_MIN_SAMPLES) return null

  let coef = fitPlane(pts)
  if (!coef) return null
  // Two rounds of robust trimming: chimneys, vents, and tree limbs are outliers, not roof.
  for (let round = 0; round < 2; round++) {
    const [a, b, c] = coef
    const res = pts.map((p) => p.z - (a * p.x + b * p.y + c))
    const mad = median(res.map((r) => Math.abs(r - median(res))))
    const cut = Math.max(0.12, 3 * 1.4826 * mad)
    const kept = pts.filter((_, i) => Math.abs(res[i]) <= cut)
    if (kept.length < DSM_PLANE_MIN_SAMPLES || kept.length === pts.length) break
    pts = kept
    const next = fitPlane(pts)
    if (!next) break
    coef = next
  }

  const [a, b, c] = coef
  const rmseM = Math.sqrt(pts.reduce((s, p) => s + (p.z - (a * p.x + b * p.y + c)) ** 2, 0) / pts.length)
  if (rmseM > DSM_PLANE_MAX_RMSE_M) return null

  const grad = Math.hypot(a, b)
  const pitchDegrees = (Math.atan(grad) * 180) / Math.PI
  // Water runs down the gradient: toward (-a, -b) in (east, north).
  const drainAzimuthDegrees =
    pitchDegrees < DSM_PLANE_FLAT_PITCH_DEG ? null : (((Math.atan2(-a, -b) * 180) / Math.PI) + 360) % 360

  return { drainAzimuthDegrees, pitchDegrees, heightAtCentroidM: c, a, b, c, origin, samples: pts.length, rmseM }
}

/** Height of a fitted plane at a lat/lng. */
export function dsmPlaneHeightAt(plane: FacetDsmPlane, p: RoofMeasurePoint): number {
  const q = toLocal(p, plane.origin)
  return plane.a * q.x + plane.b * q.y + plane.c
}

/**
 * Classify an interior edge between two fitted planes from 3D geometry alone:
 * - convex fold (each plane falls away from the edge into its own facet) → ridge or hip,
 *   concave (each rises) → valley;
 * - ridge vs hip by whether the edge itself is level: a ridge runs flat, a hip descends
 *   at roughly pitch/√2. Returns null when the geometry is ambiguous (caller keeps the
 *   2D answer).
 */
export const DSM_RIDGE_MAX_EDGE_SLOPE_DEG = 7

export function classifyEdgeFromDsmPlanes(
  p1: RoofMeasurePoint,
  p2: RoofMeasurePoint,
  planeA: FacetDsmPlane,
  centroidA: RoofMeasurePoint,
  planeB: FacetDsmPlane,
  centroidB: RoofMeasurePoint
): 'ridge' | 'hip' | 'valley' | null {
  const origin = { lat: (p1.lat + p2.lat) / 2, lng: (p1.lng + p2.lng) / 2 }
  const e1 = toLocal(p1, origin)
  const e2 = toLocal(p2, origin)
  const len = Math.hypot(e2.x - e1.x, e2.y - e1.y)
  if (len < 0.5) return null

  // Unit normal to the edge, then point it into each facet (toward its centroid).
  const n = { x: -(e2.y - e1.y) / len, y: (e2.x - e1.x) / len }
  const into = (cent: RoofMeasurePoint) => {
    const c = toLocal(cent, origin)
    return c.x * n.x + c.y * n.y >= 0 ? n : { x: -n.x, y: -n.y }
  }
  const step = 1.0
  const fallInto = (plane: FacetDsmPlane, cent: RoofMeasurePoint) => {
    const d = into(cent)
    const inside = toLatLng({ x: d.x * step, y: d.y * step }, origin)
    return dsmPlaneHeightAt(plane, inside) - dsmPlaneHeightAt(plane, origin)
  }
  const dA = fallInto(planeA, centroidA)
  const dB = fallInto(planeB, centroidB)
  // Need a clear fold on both sides (~>5° over the 1 m step).
  const minFold = 0.08
  let fold: 'convex' | 'concave'
  if (dA < -minFold && dB < -minFold) fold = 'convex'
  else if (dA > minFold && dB > minFold) fold = 'concave'
  else return null
  if (fold === 'concave') return 'valley'

  const zAt = (p: RoofMeasurePoint) => (dsmPlaneHeightAt(planeA, p) + dsmPlaneHeightAt(planeB, p)) / 2
  const edgeSlopeDeg = (Math.atan(Math.abs(zAt(p2) - zAt(p1)) / len) * 180) / Math.PI
  return edgeSlopeDeg <= DSM_RIDGE_MAX_EDGE_SLOPE_DEG ? 'ridge' : 'hip'
}
