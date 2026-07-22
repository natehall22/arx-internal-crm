/**
 * Plane-intersection roof reconstruction — Phase 1 of the measurement-report engine.
 *
 * Reconstructs clean, straight, correctly-TYPED interior edges (ridge / hip / valley) by
 * intersecting Google Solar roof planes, rather than relying on jagged mask contours and
 * the brittle 2D drain-azimuth classifier (which misclassifies auto-dropped hip roofs —
 * e.g. 150 McShag reported 191 LF of phantom rakes on a roof that has zero).
 *
 * Two adjacent roof planes meet along the line where their surfaces are equal height. From
 * each plane's equation n·(x,y,z)=d that line is exact and STRAIGHT in plan view, and its
 * type follows from the geometry: opposite-facing planes → ridge; ~90° convex → hip;
 * ~90° concave → valley. All inputs are FREE Google Solar data (pitch, azimuth,
 * planeHeightAtCenterMeters, center). No imagery purchase, no pixel tracing.
 *
 * This module is pure geometry (no I/O) so it is deterministically unit-testable.
 */

const M_PER_DEG_LAT = 111320

export type LatLng = { lat: number; lng: number }

export type ReconSegment = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  plane_height_at_center_meters: number | null
  center: LatLng | null
}

/** A Solar roof plane in a local ENU frame (meters): normal·(x,y,z) = d, with nz > 0. */
export type ReconPlane = {
  segment_index: number
  azimuth_degrees: number
  pitch_degrees: number
  nx: number
  ny: number
  nz: number
  d: number
  cx: number
  cy: number
  cz: number
}

export type ReconEdgeType = 'ridge' | 'hip' | 'valley'

/** Plan-view shared edge between two planes: the line A·x + B·y = C (local meters). */
export type ReconSharedEdge = {
  a: number
  b: number
  type: ReconEdgeType
  A: number
  B: number
  C: number
  /** Unit direction of the line in plan view. */
  dirX: number
  dirY: number
}

/** Azimuth threshold: flanking planes >= this many degrees apart read as a ridge, not a hip. */
export const RECON_RIDGE_AZIMUTH_DEG = 135

export function localMetersPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

/** Build the local-ENU plane for a Solar segment; null when pitch/azimuth/height/center missing. */
export function buildReconPlane(seg: ReconSegment, origin: LatLng): ReconPlane | null {
  const { pitch_degrees: pitch, azimuth_degrees: az, plane_height_at_center_meters: h, center } = seg
  if (
    center == null ||
    pitch == null ||
    az == null ||
    h == null ||
    !Number.isFinite(pitch) ||
    !Number.isFinite(az) ||
    !Number.isFinite(h)
  ) {
    return null
  }
  const mLng = localMetersPerDegLng(origin.lat)
  const p = (pitch * Math.PI) / 180
  const a = (az * Math.PI) / 180
  const nx = Math.sin(p) * Math.sin(a)
  const ny = Math.sin(p) * Math.cos(a)
  const nz = Math.cos(p)
  const cx = (center.lng - origin.lng) * mLng
  const cy = (center.lat - origin.lat) * M_PER_DEG_LAT
  const cz = h
  return { segment_index: seg.segment_index, azimuth_degrees: az, pitch_degrees: pitch, nx, ny, nz, d: nx * cx + ny * cy + nz * cz, cx, cy, cz }
}

/** Height plane `pl` predicts at plan-view point (x, y). */
export function planeHeightAt(pl: ReconPlane, x: number, y: number): number {
  return (pl.d - pl.nx * x - pl.ny * y) / pl.nz
}

function normalizeAngleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Plan-view line where the two planes are equal height (z_a = z_b): A·x + B·y = C.
 * Derived by cross-multiplying (d_a - n_a·(x,y))/n_az = (d_b - n_b·(x,y))/n_bz.
 * Returns null for (near-)parallel planes with no well-defined intersection.
 */
export function sharedEdgeLine(
  a: ReconPlane,
  b: ReconPlane
): { A: number; B: number; C: number; dirX: number; dirY: number } | null {
  const A = b.nz * a.nx - a.nz * b.nx
  const B = b.nz * a.ny - a.nz * b.ny
  const C = b.nz * a.d - a.nz * b.d
  const mag = Math.hypot(A, B)
  if (mag < 1e-9) return null
  // Line direction is perpendicular to the (A,B) gradient.
  return { A, B, C, dirX: -B / mag, dirY: A / mag }
}

/**
 * Whether the two planes fold CONVEX (tent — a ridge or hip) vs CONCAVE (a V — a valley)
 * at their shared line, from plane heights alone. Azimuth cannot tell these apart: a gable
 * ridge and a butterfly/T-valley can both be ~180° or ~90°. Step just off the shared line
 * onto plane A's own side; there the actual roof is plane A, so if A sits BELOW plane B's
 * extension the surfaces tent upward (convex), and if ABOVE they form a V (concave).
 */
export function isConvexFold(a: ReconPlane, b: ReconPlane): boolean {
  const mx = (a.cx + b.cx) / 2
  const my = (a.cy + b.cy) / 2
  const towardA = Math.hypot(a.cx - mx, a.cy - my) || 1
  const eps = 0.5 // meters onto plane A's side of the shared line
  const ax = mx + ((a.cx - mx) / towardA) * eps
  const ay = my + ((a.cy - my) / towardA) * eps
  return planeHeightAt(a, ax, ay) < planeHeightAt(b, ax, ay)
}

/**
 * Classify the shared edge between two adjacent planes: convexity first (valley when
 * concave, regardless of azimuth), then ridge vs hip by azimuth for the convex case.
 */
export function classifyReconEdge(a: ReconPlane, b: ReconPlane): ReconEdgeType {
  if (!isConvexFold(a, b)) return 'valley'
  return normalizeAngleDiff(a.azimuth_degrees, b.azimuth_degrees) >= RECON_RIDGE_AZIMUTH_DEG
    ? 'ridge'
    : 'hip'
}

/**
 * Whether two planes are adjacent (share a boundary) — a coarse proximity gate on their
 * centers so non-touching opposite planes (e.g. the two triangular hip ends of a rectangle)
 * are not treated as sharing the ridge. Callers with a footprint/facet layout should prefer
 * a topological adjacency; this is the geometry-only fallback.
 */
export function planesLikelyAdjacent(a: ReconPlane, b: ReconPlane, maxCenterMeters: number): boolean {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) <= maxCenterMeters
}

const M_TO_FT = 3.280839895

export type ReconPoint = { x: number; y: number }
type Line = { A: number; B: number; C: number; dirX: number; dirY: number }

function cross(o: ReconPoint, a: ReconPoint, b: ReconPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Monotone-chain convex hull (counter-clockwise). Used as a footprint for convex roofs. */
export function convexHull(points: ReconPoint[]): ReconPoint[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y)
  if (pts.length < 3) return pts
  const lower: ReconPoint[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: ReconPoint[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function pointOnLine(l: Line): ReconPoint {
  return Math.abs(l.A) >= Math.abs(l.B) ? { x: l.C / l.A, y: 0 } : { x: 0, y: l.C / l.B }
}

function lineIntersect(l1: Line, l2: Line): ReconPoint | null {
  const det = l1.A * l2.B - l2.A * l1.B
  if (Math.abs(det) < 1e-9) return null
  return { x: (l1.C * l2.B - l2.C * l1.B) / det, y: (l1.A * l2.C - l2.A * l1.C) / det }
}

/** Parameter t along an infinite line (P0 + t·dir) where it crosses segment p→q, or null. */
function lineParamAtSegment(P0: ReconPoint, dir: ReconPoint, p: ReconPoint, q: ReconPoint): number | null {
  const ex = q.x - p.x
  const ey = q.y - p.y
  const det = dir.x * -ey - dir.y * -ex
  if (Math.abs(det) < 1e-12) return null
  const rx = p.x - P0.x
  const ry = p.y - P0.y
  const t = (rx * -ey - ry * -ex) / det
  const s = (dir.x * ry - dir.y * rx) / det
  return s >= -1e-6 && s <= 1 + 1e-6 ? t : null
}

function pointInPolygon(pt: ReconPoint, poly: ReconPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distancePointToSegment(pt: ReconPoint, a: ReconPoint, b: ReconPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.hypot(pt.x - a.x, pt.y - a.y)
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq))
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy))
}

function distancePointToPolygonBoundary(pt: ReconPoint, poly: ReconPoint[]): number {
  if (poly.length < 2) return Infinity
  let min = Infinity
  for (let i = 0; i < poly.length; i++) {
    const d = distancePointToSegment(pt, poly[i], poly[(i + 1) % poly.length])
    if (d < min) min = d
  }
  return min
}

function pointInAnyFacet(pt: ReconPoint, facetPolys: ReconPoint[][], adjTol = RECON_ADJ_TOL_METERS): boolean {
  return facetPolys.some(
    (poly) => pointInPolygon(pt, poly) || distancePointToPolygonBoundary(pt, poly) <= adjTol
  )
}

/** Default adjacency tolerance for facet-local exterior/interior edge ownership (meters). */
export const RECON_ADJ_TOL_METERS = 0.85

function isExteriorFacetEdge(ownerIdx: number, mid: ReconPoint, facetPolys: ReconPoint[][], adjTol: number): boolean {
  for (let j = 0; j < facetPolys.length; j++) {
    if (j === ownerIdx) continue
    if (pointInPolygon(mid, facetPolys[j])) return false
    if (distancePointToPolygonBoundary(mid, facetPolys[j]) <= adjTol) return false
  }
  return true
}

/** Two-lowest among planes whose facets are near the sample point (pair must both be near). */
function localTwoLowestForPair(
  x: number,
  y: number,
  aIdx: number,
  bIdx: number,
  planes: ReconPlane[],
  facetPolys: ReconPoint[][],
  adjTol: number
): Set<number> {
  const pt = { x, y }
  const near = (idx: number) =>
    pointInPolygon(pt, facetPolys[idx]) || distancePointToPolygonBoundary(pt, facetPolys[idx]) <= adjTol
  if (!near(aIdx) || !near(bIdx)) return new Set()
  const candidates = planes.filter((_, idx) => near(idx))
  const hs = candidates.map((p) => ({ i: p.segment_index, z: planeHeightAt(p, x, y) })).sort((u, v) => u.z - v.z)
  return new Set([hs[0]?.i, hs[1]?.i])
}

function nearBothFacets(pt: ReconPoint, aIdx: number, bIdx: number, facetPolys: ReconPoint[][], adjTol: number): boolean {
  const near = (idx: number) =>
    pointInPolygon(pt, facetPolys[idx]) || distancePointToPolygonBoundary(pt, facetPolys[idx]) <= adjTol
  // Must be adjacent to BOTH facets — OR invents phantom interior edges from non-touching pairs.
  return near(aIdx) && near(bIdx)
}

function mergeColinearVertices(pts: ReconPoint[], mergeMeters: number): ReconPoint[] {
  if (pts.length < 3) return pts
  const out: ReconPoint[] = []
  for (let i = 0; i < pts.length; i++) {
    const prev = out[out.length - 1] ?? pts[(i + pts.length - 1) % pts.length]
    const cur = pts[i]
    const next = pts[(i + 1) % pts.length]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) {
      out.push(cur)
      continue
    }
    const deviation = Math.abs((dy * cur.x - dx * cur.y + next.x * prev.y - next.y * prev.x) / len)
    if (out.length > 0 && deviation < mergeMeters) continue
    out.push(cur)
  }
  if (out.length >= 3) {
    const first = out[0]
    const last = out[out.length - 1]
    const next = out[1]
    const dx = next.x - last.x
    const dy = next.y - last.y
    const len = Math.hypot(dx, dy)
    if (len > 1e-9) {
      const deviation = Math.abs((dy * first.x - dx * first.y + next.x * last.x - next.y * last.y) / len)
      if (deviation < mergeMeters) out.shift()
    }
  }
  return out.length >= 3 ? out : pts
}

/**
 * Snap a closed polygon toward 1–2 dominant edge directions (length-weighted histogram).
 * Preserves edge lengths; merges near-colinear vertices afterward.
 */
export function straightenPolygon(
  pts: ReconPoint[],
  options?: { snapDeg?: number; mergeMeters?: number; binDeg?: number }
): ReconPoint[] {
  if (pts.length < 3) return [...pts]
  const snapRad = ((options?.snapDeg ?? 15) * Math.PI) / 180
  const mergeMeters = options?.mergeMeters ?? 0.2
  const binRad = ((options?.binDeg ?? 5) * Math.PI) / 180
  const n = pts.length
  const lengths: number[] = []
  const angles: number[] = []
  for (let i = 0; i < n; i++) {
    const dx = pts[(i + 1) % n].x - pts[i].x
    const dy = pts[(i + 1) % n].y - pts[i].y
    const len = Math.hypot(dx, dy)
    lengths.push(len)
    angles.push(Math.atan2(dy, dx))
  }
  const numBins = Math.max(1, Math.ceil(Math.PI / binRad))
  const hist = new Array<number>(numBins).fill(0)
  for (let i = 0; i < n; i++) {
    if (lengths[i] < 1e-6) continue
    let a = angles[i] % Math.PI
    if (a < 0) a += Math.PI
    hist[Math.min(numBins - 1, Math.floor(a / binRad))] += lengths[i]
  }
  let maxW = 0
  let primaryBin = 0
  for (let i = 0; i < numBins; i++) {
    if (hist[i] > maxW) {
      maxW = hist[i]
      primaryBin = i
    }
  }
  const primary = (primaryBin + 0.5) * binRad
  const totalW = hist.reduce((s, w) => s + w, 0)
  const orthAngle = (primary + Math.PI / 2) % Math.PI
  const orthBin = Math.min(numBins - 1, Math.floor(orthAngle / binRad))
  const orthW = hist[orthBin] + hist[(orthBin + Math.round(Math.PI / binRad / 2)) % numBins]
  const dominants = [primary]
  if (orthW > totalW * 0.2) dominants.push(orthAngle)

  const snapEdgeAngle = (angle: number): number => {
    let best = angle
    let bestDiff = Infinity
    for (const d of dominants) {
      for (const cand of [d, d + Math.PI, d - Math.PI]) {
        const diff = Math.abs(Math.atan2(Math.sin(angle - cand), Math.cos(angle - cand)))
        if (diff < bestDiff) {
          bestDiff = diff
          best = diff <= snapRad ? cand : angle
        }
      }
    }
    return bestDiff <= snapRad ? best : angle
  }

  const snapped = angles.map(snapEdgeAngle)
  const out: ReconPoint[] = [{ ...pts[0] }]
  for (let i = 0; i < n; i++) {
    const prev = out[out.length - 1]
    out.push({
      x: prev.x + lengths[i] * Math.cos(snapped[i]),
      y: prev.y + lengths[i] * Math.sin(snapped[i]),
    })
  }
  out.pop()
  return mergeColinearVertices(out, mergeMeters)
}

/** Ratio of true 3D length to plan-view length along a plan-view direction on a plane. */
function slope3dFactor(nx: number, ny: number, nz: number, dirX: number, dirY: number): number {
  const dzdl = -(nx * dirX + ny * dirY) / nz
  return Math.sqrt(1 + dzdl * dzdl)
}

export type ReconMeasuredEdge = { a: number; b: number; type: ReconEdgeType; lengthFt: number }
export type ReconMeasurement = {
  edges: ReconMeasuredEdge[]
  ridgeLf: number
  hipLf: number
  valleyLf: number
  eavesLf: number
  rakesLf: number
}

/**
 * Measure the roof's edges from its planes + footprint (convex-roof / lower-envelope model).
 *
 * Interior edges: each plane-pair's shared line is a real edge only on the sub-segment where
 * that pair is the two LOWEST planes (the lower envelope = the physical roof for a convex
 * roof). We split each line at its intersections with the footprint and the other shared
 * lines, then keep the sub-segments whose midpoint is owned by exactly those two planes.
 * Exterior edges: each footprint edge is an eave when the owning plane's downslope crosses it
 * (⊥), else a rake — evaluated on the CLEAN footprint, fixing the jagged-contour eave/rake
 * misclassification. Lengths in feet. Valleys (concave) need the Phase-2b local model.
 */
export function measureReconstructedEdges(planes: ReconPlane[], footprint: ReconPoint[]): ReconMeasurement {
  const lines = [] as { a: ReconPlane; b: ReconPlane; line: Line }[]
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const line = sharedEdgeLine(planes[i], planes[j])
      if (line) lines.push({ a: planes[i], b: planes[j], line })
    }
  }

  const twoLowest = (x: number, y: number): Set<number> => {
    const hs = planes
      .map((p) => ({ i: p.segment_index, z: planeHeightAt(p, x, y) }))
      .sort((u, v) => u.z - v.z)
    return new Set([hs[0]?.i, hs[1]?.i])
  }

  const byPair = new Map<string, ReconMeasuredEdge>()
  for (const { a, b, line } of lines) {
    const P0 = pointOnLine(line)
    const dir = { x: line.dirX, y: line.dirY }
    const factor = slope3dFactor(a.nx, a.ny, a.nz, dir.x, dir.y)
    const ts: number[] = []
    for (let k = 0; k < footprint.length; k++) {
      const t = lineParamAtSegment(P0, dir, footprint[k], footprint[(k + 1) % footprint.length])
      if (t != null) ts.push(t)
    }
    for (const other of lines) {
      if (other.line === line) continue
      const ip = lineIntersect(line, other.line)
      if (ip) ts.push((ip.x - P0.x) * dir.x + (ip.y - P0.y) * dir.y)
    }
    ts.sort((u, v) => u - v)
    for (let k = 0; k + 1 < ts.length; k++) {
      const tm = (ts[k] + ts[k + 1]) / 2
      const pm = { x: P0.x + tm * dir.x, y: P0.y + tm * dir.y }
      if (!pointInPolygon(pm, footprint)) continue
      const low = twoLowest(pm.x, pm.y)
      if (!low.has(a.segment_index) || !low.has(b.segment_index)) continue
      const lengthFt = (ts[k + 1] - ts[k]) * M_TO_FT * factor
      if (lengthFt < 0.3) continue
      const key = `${Math.min(a.segment_index, b.segment_index)}-${Math.max(a.segment_index, b.segment_index)}`
      const existing = byPair.get(key)
      if (existing) existing.lengthFt += lengthFt
      else byPair.set(key, { a: a.segment_index, b: b.segment_index, type: classifyReconEdge(a, b), lengthFt })
    }
  }

  // Exterior eaves / rakes from the (clean) footprint boundary.
  const cx = footprint.reduce((s, p) => s + p.x, 0) / footprint.length
  const cy = footprint.reduce((s, p) => s + p.y, 0) / footprint.length
  let eavesLf = 0
  let rakesLf = 0
  for (let k = 0; k < footprint.length; k++) {
    const p = footprint[k]
    const q = footprint[(k + 1) % footprint.length]
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    if (len < 0.3) continue
    const edgeDir = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    const inward = { x: cx - mid.x, y: cy - mid.y }
    const il = Math.hypot(inward.x, inward.y) || 1
    const probe = { x: mid.x + (inward.x / il) * 0.5, y: mid.y + (inward.y / il) * 0.5 }
    const owner = planes.reduce((best, pl) =>
      planeHeightAt(pl, probe.x, probe.y) < planeHeightAt(best, probe.x, probe.y) ? pl : best
    )
    const az = (owner.azimuth_degrees * Math.PI) / 180
    const dot = Math.abs(Math.sin(az) * edgeDir.x + Math.cos(az) * edgeDir.y)
    const len3d = len * M_TO_FT * slope3dFactor(owner.nx, owner.ny, owner.nz, edgeDir.x, edgeDir.y)
    if (dot < 0.5) eavesLf += len3d
    else rakesLf += len3d
  }

  const edges = Array.from(byPair.values())
  const sum = (t: ReconEdgeType) => edges.filter((e) => e.type === t).reduce((s, e) => s + e.lengthFt, 0)
  return {
    edges,
    ridgeLf: Math.round(sum('ridge')),
    hipLf: Math.round(sum('hip')),
    valleyLf: Math.round(sum('valley')),
    eavesLf: Math.round(eavesLf),
    rakesLf: Math.round(rakesLf),
  }
}

/**
 * Facet-local edge measurement (Phase 2b): exterior edges from per-facet polygons (not convex
 * hull), interior shared lines with local two-lowest ownership (allows valleys/concave roofs).
 */
export function measureFacetLocalEdges(
  planes: ReconPlane[],
  facetPolys: ReconPoint[][],
  adjTol = RECON_ADJ_TOL_METERS
): ReconMeasurement {
  const lines = [] as { a: ReconPlane; b: ReconPlane; aIdx: number; bIdx: number; line: Line }[]
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const line = sharedEdgeLine(planes[i], planes[j])
      if (line) lines.push({ a: planes[i], b: planes[j], aIdx: i, bIdx: j, line })
    }
  }

  const byPair = new Map<string, ReconMeasuredEdge>()
  for (const { a, b, aIdx, bIdx, line } of lines) {
    const P0 = pointOnLine(line)
    const dir = { x: line.dirX, y: line.dirY }
    const factor = slope3dFactor(a.nx, a.ny, a.nz, dir.x, dir.y)
    const ts: number[] = []
    for (const poly of facetPolys) {
      for (let k = 0; k < poly.length; k++) {
        const t = lineParamAtSegment(P0, dir, poly[k], poly[(k + 1) % poly.length])
        if (t != null) ts.push(t)
      }
    }
    for (const other of lines) {
      if (other.line === line) continue
      const ip = lineIntersect(line, other.line)
      if (ip) ts.push((ip.x - P0.x) * dir.x + (ip.y - P0.y) * dir.y)
    }
    ts.sort((u, v) => u - v)
    for (let k = 0; k + 1 < ts.length; k++) {
      const tm = (ts[k] + ts[k + 1]) / 2
      const pm = { x: P0.x + tm * dir.x, y: P0.y + tm * dir.y }
      if (!pointInAnyFacet(pm, facetPolys, adjTol)) continue
      if (!nearBothFacets(pm, aIdx, bIdx, facetPolys, adjTol)) continue
      const low = localTwoLowestForPair(pm.x, pm.y, aIdx, bIdx, planes, facetPolys, adjTol)
      if (!low.has(a.segment_index) || !low.has(b.segment_index)) continue
      const lengthFt = (ts[k + 1] - ts[k]) * M_TO_FT * factor
      if (lengthFt < 0.3) continue
      const key = `${Math.min(a.segment_index, b.segment_index)}-${Math.max(a.segment_index, b.segment_index)}`
      const existing = byPair.get(key)
      if (existing) existing.lengthFt += lengthFt
      else byPair.set(key, { a: a.segment_index, b: b.segment_index, type: classifyReconEdge(a, b), lengthFt })
    }
  }

  let eavesLf = 0
  let rakesLf = 0
  for (let fi = 0; fi < facetPolys.length; fi++) {
    const poly = facetPolys[fi]
    const owner = planes[fi]
    if (!owner || poly.length < 3) continue
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]
      const q = poly[(k + 1) % poly.length]
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      if (len < 0.3) continue
      const edgeDir = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      if (!isExteriorFacetEdge(fi, mid, facetPolys, adjTol)) continue
      const az = (owner.azimuth_degrees * Math.PI) / 180
      const dot = Math.abs(Math.sin(az) * edgeDir.x + Math.cos(az) * edgeDir.y)
      const len3d = len * M_TO_FT * slope3dFactor(owner.nx, owner.ny, owner.nz, edgeDir.x, edgeDir.y)
      if (dot < 0.5) eavesLf += len3d
      else rakesLf += len3d
    }
  }

  const edges = Array.from(byPair.values())
  const sum = (t: ReconEdgeType) => edges.filter((e) => e.type === t).reduce((s, e) => s + e.lengthFt, 0)
  return {
    edges,
    ridgeLf: Math.round(sum('ridge')),
    hipLf: Math.round(sum('hip')),
    valleyLf: Math.round(sum('valley')),
    eavesLf: Math.round(eavesLf),
    rakesLf: Math.round(rakesLf),
  }
}

function polygonAreaM2(pts: ReconPoint[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

function estimatePerimeterFt(facetPolys: ReconPoint[][]): number {
  const areaM2 = facetPolys.reduce((s, p) => s + polygonAreaM2(p), 0)
  if (areaM2 <= 0) return 0
  return 4 * Math.sqrt(areaM2) * M_TO_FT
}

function polygonAreaSqftLocal(pts: ReconPoint[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return (Math.abs(s) / 2) * 10.7639104
}

function centroidLatLng(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null
  const n = points.length
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  }
}

/** A drawn/auto facet with the Solar plane metadata needed to reconstruct edges. */
export type ReconFacetInput = {
  points: LatLng[]
  suggested_pitch_degrees?: number | null
  pitch_degrees?: number | null
  suggested_azimuth_degrees?: number | null
  facing_azimuth_degrees?: number | null
  plane_height_at_center_meters?: number | null
  center?: LatLng | null
}

export type ReconRoofLf = ReconMeasurement & {
  /** True when reconstruction is trustworthy (convex hip/gable or facet-local valley/concave). */
  reliable: boolean
  reason: string
}

const ZERO_MEASUREMENT: ReconMeasurement = {
  edges: [],
  ridgeLf: 0,
  hipLf: 0,
  valleyLf: 0,
  eavesLf: 0,
  rakesLf: 0,
}

/**
 * Reconstruct roof linear footage from a set of facets carrying Solar plane metadata, with a
 * reliability gate. Prefers the facet-local model (Phase 2b) when each facet has a valid
 * polygon; falls back to convex-hull lower envelope when polygons are missing/degenerate.
 * Uses each facet's own Solar pitch/azimuth/height; falls back to the facet centroid when a
 * segment center is absent.
 */
export function reconstructRoofLf(facets: ReconFacetInput[]): ReconRoofLf | null {
  if (facets.length < 2) return null
  const origin = facets[0].center ?? centroidLatLng(facets[0].points)
  if (!origin) return null
  const mLng = localMetersPerDegLng(origin.lat)
  const toLocal = (p: LatLng): ReconPoint => ({
    x: (p.lng - origin.lng) * mLng,
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  })

  const planes: ReconPlane[] = []
  const facetPolysRaw: ReconPoint[][] = []
  const allVerts: ReconPoint[] = []
  let facetAreaSqft = 0
  for (let i = 0; i < facets.length; i++) {
    const f = facets[i]
    const center = f.center ?? centroidLatLng(f.points)
    if (!center) return { ...ZERO_MEASUREMENT, reliable: false, reason: 'facet missing center' }
    const plane = buildReconPlane(
      {
        segment_index: i,
        pitch_degrees: f.suggested_pitch_degrees ?? f.pitch_degrees ?? null,
        azimuth_degrees: f.suggested_azimuth_degrees ?? f.facing_azimuth_degrees ?? null,
        plane_height_at_center_meters: f.plane_height_at_center_meters ?? null,
        center,
      },
      origin
    )
    if (!plane) return { ...ZERO_MEASUREMENT, reliable: false, reason: 'facet missing pitch/azimuth/height' }
    planes.push(plane)
    const local = f.points.map(toLocal)
    facetPolysRaw.push(local)
    for (const p of local) allVerts.push(p)
    facetAreaSqft += polygonAreaSqftLocal(local)
  }

  if (facetAreaSqft <= 0) {
    return { ...ZERO_MEASUREMENT, reliable: false, reason: 'degenerate facet polygons' }
  }

  const footprint = convexHull(allVerts)
  if (footprint.length < 3) return { ...ZERO_MEASUREMENT, reliable: false, reason: 'degenerate footprint' }
  const concavity = polygonAreaSqftLocal(footprint) / facetAreaSqft
  const convexFootprint = concavity <= 1.12

  const useFacetLocal = facetPolysRaw.every((p) => p.length >= 3)
  let measurement: ReconMeasurement
  if (useFacetLocal) {
    const facetPolys = facetPolysRaw.map((p) => straightenPolygon(p))
    measurement = measureFacetLocalEdges(planes, facetPolys)
  } else {
    measurement = measureReconstructedEdges(planes, footprint)
  }

  const perimeterEst = estimatePerimeterFt(facetPolysRaw)
  const exteriorTotal = measurement.eavesLf + measurement.rakesLf
  const interiorTotal = measurement.ridgeLf + measurement.hipLf + measurement.valleyLf
  const empty =
    exteriorTotal === 0 &&
    interiorTotal === 0 &&
    measurement.edges.length === 0
  const absurdExterior = perimeterEst > 0 && exteriorTotal > 3 * perimeterEst
  const absurdInterior = perimeterEst > 0 && interiorTotal > 3 * perimeterEst
  const coherent = exteriorTotal > 0 || measurement.edges.length > 0

  let reliable = false
  let reason: string

  if (empty) {
    reliable = false
    reason = 'facet-local produced empty measurement — 2D fallback'
  } else if (!useFacetLocal) {
    reliable = convexFootprint && measurement.valleyLf === 0 && !absurdExterior && !absurdInterior
    reason = !convexFootprint
      ? `concave footprint (${concavity.toFixed(2)}× hull vs facets) — 2D fallback`
      : measurement.valleyLf > 0
        ? 'valley present — 2D fallback'
        : reliable
          ? 'convex roof — reconstructed'
          : 'convex hull measurement failed sanity — 2D fallback'
  } else if (measurement.valleyLf > 0 || !convexFootprint) {
    if (!convexFootprint && measurement.valleyLf === 0) {
      reliable = false
      reason = `concave footprint (${concavity.toFixed(2)}× hull vs facets) but no valley — 2D fallback`
    } else {
      reliable = coherent && !absurdExterior && !absurdInterior
      reason = reliable
        ? 'facet-local valley/concave — reconstructed'
        : !coherent
          ? 'facet-local incoherent totals — 2D fallback'
          : 'facet-local failed sanity — 2D fallback'
    }
  } else {
    reliable = !absurdExterior && !absurdInterior
    reason = reliable ? 'convex roof — reconstructed' : 'facet-local failed sanity — 2D fallback'
  }

  return { ...measurement, reliable, reason }
}

/**
 * Reconstruct the typed interior shared edges for a set of Solar planes.
 * `adjacent` decides which plane pairs actually meet; defaults to the center-proximity gate.
 */
export function reconstructSharedEdges(
  planes: ReconPlane[],
  options?: { adjacent?: (a: ReconPlane, b: ReconPlane) => boolean; maxCenterMeters?: number }
): ReconSharedEdge[] {
  const maxCenter = options?.maxCenterMeters ?? 12
  const adjacent = options?.adjacent ?? ((a, b) => planesLikelyAdjacent(a, b, maxCenter))
  const out: ReconSharedEdge[] = []
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const a = planes[i]
      const b = planes[j]
      if (!adjacent(a, b)) continue
      const line = sharedEdgeLine(a, b)
      if (!line) continue
      out.push({ a: a.segment_index, b: b.segment_index, type: classifyReconEdge(a, b), ...line })
    }
  }
  return out
}
