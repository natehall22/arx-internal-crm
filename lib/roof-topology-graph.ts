/**
 * Constrained plane-intersection roof topology graph (Roofr-path Increment 1).
 * Verified footprint → graph (typed edges) → facets from lower envelope, not DSM contours.
 * Pure geometry — no I/O.
 */

import {
  buildReconPlane,
  classifyReconEdgeAt,
  convexHull,
  isConvexFold,
  isRidgeTentAtPoint,
  localMetersPerDegLng,
  planeHeightAt,
  planesLikelyAdjacent,
  sharedEdgeLine,
  straightenPolygon,
  TENT_RIDGE_MAX_CENTER_M,
  RIDGE_TENT_MAX_REL_GAP,
  type LatLng,
  type ReconPlane,
  type ReconPoint,
} from '@/lib/roof-plane-reconstruction'

const M_PER_DEG_LAT = 111320
const M_TO_FT = 3.280839895
const M2_TO_SQFT = 10.7639104
const MIN_FOOTPRINT_SQFT = 50
const MIN_FOOTPRINT_M2 = MIN_FOOTPRINT_SQFT / M2_TO_SQFT
const MIN_FACET_SQFT = 20
/** Drop merged shards owning less than this fraction of total footprint sample. */
const NOISE_OWNERSHIP_FRACTION = 0.05
const NODE_SNAP_M = 0.15
const GRID_STEP_M = 0.25
/** Footprint is convex-ish when hull area / footprint area ≤ this (monotone chain). */
const CONVEX_FOOTPRINT_RATIO_MAX = 1.1
/** Parallel segments within this azimuth band count as one expected plane. */
const AZIMUTH_CLUSTER_DEG = 15
/** Pitch buckets within an azimuth cluster — dormer fragments at different pitches count separately. */
const PITCH_CLUSTER_DEG = 5
const UNDERSEGMENTATION_RATIO = 0.7
/**
 * Azimuth-cluster merge before graph build (topology-only).
 * Google Solar often shards one physical face into multiple pitch estimates;
 * azimuth is the stable face identity for residential roofs. Only merge planes
 * whose azimuths differ by ≤ this (circular) — opposing gable faces (~180°)
 * and butterfly valleys stay in separate clusters.
 */
const AZIMUTH_MERGE_DEG = 20
/**
 * Pitch band for azimuth-cluster merge (topology-only).
 * Solar shards of one physical face usually stay within ~10–12° pitch; larger gaps
 * are distinct planes (dormer/wing/cross-gable). Union requires BOTH az and pitch bands.
 */
const PITCH_MERGE_DEG = 12

export type RoofEdgeKind = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake'
export type RoofGraphNode = { id: string; x: number; y: number }
export type RoofGraphEdge = {
  id: string
  a: string
  b: string
  kind: RoofEdgeKind
  planeA: number | null
  planeB: number | null
  lengthFt: number
}
export type RoofGraphFacet = {
  id: string
  planeIndex: number
  polygon: ReconPoint[]
  areaSqft: number
  pitchDegrees: number
  azimuthDegrees: number
}
export type RoofTopologyResult = {
  status: 'ship' | 'force_manual'
  reason: string
  footprint: ReconPoint[]
  nodes: RoofGraphNode[]
  edges: RoofGraphEdge[]
  facets: RoofGraphFacet[]
  totals: {
    ridgeLf: number
    hipLf: number
    valleyLf: number
    eavesLf: number
    rakesLf: number
    groundSqft: number
    roofAreaSqft: number
    facetCount: number
  }
}

export type RoofTopologyInput = {
  planes: ReconPlane[]
  footprint: ReconPoint[]
  /** Pre-merge Solar planes for expected-plane counting (defaults to planes). */
  sourcePlanes?: ReconPlane[]
  /** Solar segment ground_area_m2 converted to sqft — used for expected-plane counting only. */
  groundAreaSqftBySegment?: Map<number, number>
}

type Line = { A: number; B: number; C: number; dirX: number; dirY: number }

function cross(o: ReconPoint, a: ReconPoint, b: ReconPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function pointOnLine(l: Line): ReconPoint {
  return Math.abs(l.A) >= Math.abs(l.B) ? { x: l.C / l.A, y: 0 } : { x: 0, y: l.C / l.B }
}

function lineIntersect(l1: Line, l2: Line): ReconPoint | null {
  const det = l1.A * l2.B - l2.A * l1.B
  if (Math.abs(det) < 1e-9) return null
  return { x: (l1.C * l2.B - l2.C * l1.B) / det, y: (l1.A * l2.C - l2.A * l1.C) / det }
}

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

export function pointInPolygon(pt: ReconPoint, poly: ReconPoint[]): boolean {
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

function segmentsIntersect(a: ReconPoint, b: ReconPoint, c: ReconPoint, d: ReconPoint): boolean {
  const o1 = cross(a, b, c)
  const o2 = cross(a, b, d)
  const o3 = cross(c, d, a)
  const o4 = cross(c, d, b)
  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) return false
  return o1 * o2 < 0 && o3 * o4 < 0
}

/** True when the closed ring has no self-intersections (excluding adjacent edges). */
export function isSimplePolygon(pts: ReconPoint[]): boolean {
  const n = pts.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (j === (i + n - 1) % n) continue
      const c = pts[j]
      const d = pts[(j + 1) % n]
      if (segmentsIntersect(a, b, c, d)) return false
    }
  }
  return true
}

export function polygonAreaM2(pts: ReconPoint[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

export function polygonAreaSqft(pts: ReconPoint[]): number {
  return polygonAreaM2(pts) * M2_TO_SQFT
}

function slope3dFactor(nx: number, ny: number, nz: number, dirX: number, dirY: number): number {
  const dzdl = -(nx * dirX + ny * dirY) / nz
  return Math.sqrt(1 + dzdl * dzdl)
}

function distancePointToSegment(pt: ReconPoint, a: ReconPoint, b: ReconPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.hypot(pt.x - a.x, pt.y - a.y)
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq))
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy))
}

function pointOnFootprintBoundary(pt: ReconPoint, footprint: ReconPoint[], tol = 0.2): boolean {
  for (let i = 0; i < footprint.length; i++) {
    if (distancePointToSegment(pt, footprint[i], footprint[(i + 1) % footprint.length]) <= tol) return true
  }
  return false
}

/** Lowest plane at (x,y); tie-break by closer center. Returns -1 when outside usable range. */
function lowestPlaneAt(x: number, y: number, planes: ReconPlane[]): number {
  let best = -1
  let bestZ = Infinity
  let bestDist = Infinity
  for (let i = 0; i < planes.length; i++) {
    const z = planeHeightAt(planes[i], x, y)
    const dist = Math.hypot(x - planes[i].cx, y - planes[i].cy)
    if (z < bestZ - 1e-6 || (Math.abs(z - bestZ) <= 1e-6 && dist < bestDist)) {
      bestZ = z
      best = i
      bestDist = dist
    }
  }
  return best
}

function twoLowestSegmentIndices(x: number, y: number, planes: ReconPlane[]): Set<number> {
  const hs = planes
    .map((p, idx) => ({ idx, seg: p.segment_index, z: planeHeightAt(p, x, y) }))
    .sort((u, v) => u.z - v.z || u.seg - v.seg)
  return new Set([hs[0]?.seg, hs[1]?.seg])
}

function ridgeTentRelativeGap(
  a: ReconPlane,
  b: ReconPlane,
  x: number,
  y: number,
  planes: ReconPlane[]
): number {
  const za = planeHeightAt(a, x, y)
  const zb = planeHeightAt(b, x, y)
  const ridgeZ = (za + zb) / 2
  if (ridgeZ < 1e-6) return Infinity
  let minZ = Infinity
  for (const p of planes) {
    minZ = Math.min(minZ, planeHeightAt(p, x, y))
  }
  return (ridgeZ - minZ) / ridgeZ
}

/** A. Verify and straighten exterior footprint ring. */
export function verifyFootprint(
  ring: ReconPoint[],
  options?: { snapDeg?: number; mergeMeters?: number }
): { ok: true; ring: ReconPoint[] } | { ok: false; reason: string } {
  if (ring.length < 3) return { ok: false, reason: 'footprint has fewer than 3 vertices' }
  const rawArea = polygonAreaM2(ring)
  if (rawArea < 1e-6) return { ok: false, reason: 'footprint has zero area' }
  if (!isSimplePolygon(ring)) return { ok: false, reason: 'footprint is self-intersecting' }

  const straight = straightenPolygon(ring, options)
  if (straight.length < 3) return { ok: false, reason: 'too few vertices after straighten' }
  if (!isSimplePolygon(straight)) return { ok: false, reason: 'self-intersecting after straighten' }

  const straightArea = polygonAreaM2(straight)
  if (straightArea < MIN_FOOTPRINT_M2) {
    return { ok: false, reason: `footprint area ${polygonAreaSqft(straight).toFixed(0)} sqft below ${MIN_FOOTPRINT_SQFT} minimum` }
  }
  if (straightArea < rawArea * 0.85) {
    return { ok: false, reason: 'straighten collapsed footprint area by more than 15%' }
  }

  return { ok: true, ring: straight }
}

class NodeStore {
  private nodes: RoofGraphNode[] = []
  private nextId = 0

  add(x: number, y: number): string {
    for (const n of this.nodes) {
      if (Math.hypot(n.x - x, n.y - y) <= NODE_SNAP_M) return n.id
    }
    const id = `n${this.nextId++}`
    this.nodes.push({ id, x, y })
    return id
  }

  list(): RoofGraphNode[] {
    return this.nodes
  }
}

/** B. Build constrained plane-intersection graph clipped to footprint (expects verified ring). */
export function buildConstrainedRoofGraph(
  planes: ReconPlane[],
  footprint: ReconPoint[]
): { nodes: RoofGraphNode[]; edges: RoofGraphEdge[] } {
  if (footprint.length < 3) return { nodes: [], edges: [] }

  const fp = footprint
  const store = new NodeStore()
  const rawEdges: Array<{
    a: string
    b: string
    kind: RoofEdgeKind
    planeA: number | null
    planeB: number | null
    lenM: number
    interior: boolean
  }> = []

  const interiorLines = [] as { a: ReconPlane; b: ReconPlane; line: Line }[]
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const line = sharedEdgeLine(planes[i], planes[j])
      if (line) interiorLines.push({ a: planes[i], b: planes[j], line })
    }
  }

  for (const { a, b, line } of interiorLines) {
    const P0 = pointOnLine(line)
    const dir = { x: line.dirX, y: line.dirY }
    const factor = slope3dFactor(a.nx, a.ny, a.nz, dir.x, dir.y)
    const ts: number[] = []
    for (let k = 0; k < fp.length; k++) {
      const t = lineParamAtSegment(P0, dir, fp[k], fp[(k + 1) % fp.length])
      if (t != null) ts.push(t)
    }
    for (const other of interiorLines) {
      if (other.line === line) continue
      const ip = lineIntersect(line, other.line)
      if (ip) ts.push((ip.x - P0.x) * dir.x + (ip.y - P0.y) * dir.y)
    }
    ts.sort((u, v) => u - v)
    for (let k = 0; k + 1 < ts.length; k++) {
      const tm = (ts[k] + ts[k + 1]) / 2
      const pm = { x: P0.x + tm * dir.x, y: P0.y + tm * dir.y }
      if (!pointInPolygon(pm, fp)) continue
      const kind = classifyReconEdgeAt(a, b, pm.x, pm.y, planes)
      const low = twoLowestSegmentIndices(pm.x, pm.y, planes)
      const onEnvelope = low.has(a.segment_index) && low.has(b.segment_index)
      const tentRidge =
        kind === 'ridge' &&
        planesLikelyAdjacent(a, b, TENT_RIDGE_MAX_CENTER_M) &&
        isRidgeTentAtPoint(a, b, pm.x, pm.y, planes) &&
        ridgeTentRelativeGap(a, b, pm.x, pm.y, planes) <= RIDGE_TENT_MAX_REL_GAP
      if (!onEnvelope && !tentRidge) continue
      const lenM = ts[k + 1] - ts[k]
      if (lenM * M_TO_FT * factor < 0.3) continue
      const na = store.add(P0.x + ts[k] * dir.x, P0.y + ts[k] * dir.y)
      const nb = store.add(P0.x + ts[k + 1] * dir.x, P0.y + ts[k + 1] * dir.y)
      rawEdges.push({
        a: na,
        b: nb,
        kind,
        planeA: a.segment_index,
        planeB: b.segment_index,
        lenM: lenM * factor,
        interior: true,
      })
    }
  }

  const cx = fp.reduce((s, p) => s + p.x, 0) / fp.length
  const cy = fp.reduce((s, p) => s + p.y, 0) / fp.length

  const boundarySplits = new Map<number, number[]>()
  for (const n of store.list()) {
    if (!pointOnFootprintBoundary(n, fp)) continue
    for (let k = 0; k < fp.length; k++) {
      const p = fp[k]
      const q = fp[(k + 1) % fp.length]
      if (distancePointToSegment(n, p, q) <= NODE_SNAP_M + 0.05) {
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const t = ((n.x - p.x) * (q.x - p.x) + (n.y - p.y) * (q.y - p.y)) / (len * len)
        if (t > 1e-4 && t < 1 - 1e-4) {
          if (!boundarySplits.has(k)) boundarySplits.set(k, [])
          boundarySplits.get(k)!.push(t)
        }
      }
    }
  }

  for (let k = 0; k < fp.length; k++) {
    const p = fp[k]
    const q = fp[(k + 1) % fp.length]
    const splits = (boundarySplits.get(k) ?? []).sort((a, b) => a - b)
    const ts = [0, ...splits, 1]
    for (let si = 0; si + 1 < ts.length; si++) {
      const t0 = ts[si]
      const t1 = ts[si + 1]
      const p0 = { x: p.x + (q.x - p.x) * t0, y: p.y + (q.y - p.y) * t0 }
      const p1 = { x: p.x + (q.x - p.x) * t1, y: p.y + (q.y - p.y) * t1 }
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      if (len < 0.3) continue
      const edgeDir = { x: (p1.x - p0.x) / len, y: (p1.y - p0.y) / len }
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
      const inward = { x: cx - mid.x, y: cy - mid.y }
      const il = Math.hypot(inward.x, inward.y) || 1
      const probe = { x: mid.x + (inward.x / il) * 0.5, y: mid.y + (inward.y / il) * 0.5 }
      const ownerIdx = lowestPlaneAt(probe.x, probe.y, planes)
      const owner = planes[ownerIdx]
      const az = (owner.azimuth_degrees * Math.PI) / 180
      const dot = Math.abs(Math.sin(az) * edgeDir.x + Math.cos(az) * edgeDir.y)
      const kind: RoofEdgeKind = dot < 0.5 ? 'eave' : 'rake'
      const len3d = len * slope3dFactor(owner.nx, owner.ny, owner.nz, edgeDir.x, edgeDir.y)
      const na = store.add(p0.x, p0.y)
      const nb = store.add(p1.x, p1.y)
      rawEdges.push({
        a: na,
        b: nb,
        kind,
        planeA: owner.segment_index,
        planeB: null,
        lenM: len3d,
        interior: false,
      })
    }
  }

  const edges: RoofGraphEdge[] = rawEdges.map((e, i) => ({
    id: `e${i}`,
    a: e.a,
    b: e.b,
    kind: e.kind,
    planeA: e.planeA,
    planeB: e.planeB,
    lengthFt: e.lenM * M_TO_FT,
  }))

  return { nodes: store.list(), edges }
}

function ptKey(x: number, y: number): string {
  return `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`
}

function chainBoundaryEdges(edges: Array<{ a: ReconPoint; b: ReconPoint }>): ReconPoint[] {
  if (edges.length === 0) return []

  const nextFrom = new Map<string, ReconPoint[]>()
  for (const e of edges) {
    const ka = ptKey(e.a.x, e.a.y)
    if (!nextFrom.has(ka)) nextFrom.set(ka, [])
    nextFrom.get(ka)!.push(e.b)
  }

  const used = new Set<string>()
  let best: ReconPoint[] = []

  for (const seed of edges) {
    const seedKey = `${ptKey(seed.a.x, seed.a.y)}->${ptKey(seed.b.x, seed.b.y)}`
    if (used.has(seedKey)) continue

    const start = { ...seed.a }
    const poly: ReconPoint[] = [start]
    let cur = { ...seed.b }
    used.add(seedKey)

    for (let guard = 0; guard < edges.length + 5; guard++) {
      if (Math.hypot(cur.x - start.x, cur.y - start.y) < 1e-9 && poly.length >= 3) break
      poly.push(cur)
      const ck = ptKey(cur.x, cur.y)
      const options = nextFrom.get(ck) ?? []
      let next: ReconPoint | null = null
      for (const opt of options) {
        const ek = `${ck}->${ptKey(opt.x, opt.y)}`
        if (used.has(ek)) continue
        used.add(ek)
        next = opt
        break
      }
      if (!next) break
      cur = next
    }

    if (poly.length >= 3 && polygonAreaM2(poly) > polygonAreaM2(best)) {
      best = poly
    }
  }

  return best
}

function facetPolygonFromGrid(
  planeIdx: number,
  grid: Map<string, number>,
  step: number,
  minX: number,
  minY: number
): ReconPoint[] | null {
  const boundary: Array<{ a: ReconPoint; b: ReconPoint }> = []
  for (const [key, owner] of Array.from(grid.entries())) {
    if (owner !== planeIdx) continue
    const [ix, iy] = key.split(',').map(Number)
    const x0 = minX + ix * step
    const y0 = minY + iy * step
    const x1 = x0 + step
    const y1 = y0 + step
    if (grid.get(`${ix - 1},${iy}`) !== planeIdx) boundary.push({ a: { x: x0, y: y0 }, b: { x: x0, y: y1 } })
    if (grid.get(`${ix + 1},${iy}`) !== planeIdx) boundary.push({ a: { x: x1, y: y1 }, b: { x: x1, y: y0 } })
    if (grid.get(`${ix},${iy - 1}`) !== planeIdx) boundary.push({ a: { x: x1, y: y0 }, b: { x: x0, y: y0 } })
    if (grid.get(`${ix},${iy + 1}`) !== planeIdx) boundary.push({ a: { x: x0, y: y1 }, b: { x: x1, y: y1 } })
  }
  if (boundary.length < 3) return null
  const poly = chainBoundaryEdges(boundary)
  return poly.length >= 3 ? poly : null
}

function halfEdgeKey(from: string, to: string): string {
  return `${from}->${to}`
}

function polygonCentroid(pts: ReconPoint[]): ReconPoint {
  let cx = 0
  let cy = 0
  for (const p of pts) {
    cx += p.x
    cy += p.y
  }
  return { x: cx / pts.length, y: cy / pts.length }
}

function pointsNear(a: ReconPoint, b: ReconPoint, tol = 1e-4): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol
}

/** CCW half-edge walk: interior of extracted faces lies to the left. */
function buildNextHalfEdgeMap(
  nodeMap: Map<string, RoofGraphNode>,
  edges: RoofGraphEdge[]
): Map<string, { from: string; to: string }> {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, [])
    if (!adj.has(e.b)) adj.set(e.b, [])
    adj.get(e.a)!.push(e.b)
    adj.get(e.b)!.push(e.a)
  }

  const sortedAdj = new Map<string, string[]>()
  for (const [vid, neighbors] of Array.from(adj.entries())) {
    const v = nodeMap.get(vid)
    if (!v) continue
    const sorted = [...neighbors].sort((a, b) => {
      const na = nodeMap.get(a)!
      const nb = nodeMap.get(b)!
      return Math.atan2(na.y - v.y, na.x - v.x) - Math.atan2(nb.y - v.y, nb.x - v.x)
    })
    sortedAdj.set(vid, sorted)
  }

  const nextMap = new Map<string, { from: string; to: string }>()
  for (const e of edges) {
    for (const [from, to] of [
      [e.a, e.b],
      [e.b, e.a],
    ] as const) {
      const neighbors = sortedAdj.get(to)
      if (!neighbors || neighbors.length < 1) continue
      const idx = neighbors.indexOf(from)
      if (idx < 0) continue
      const nextNeighbor = neighbors[(idx - 1 + neighbors.length) % neighbors.length]
      nextMap.set(halfEdgeKey(from, to), { from: to, to: nextNeighbor })
    }
  }
  return nextMap
}

function extractCycleFaces(nodes: RoofGraphNode[], edges: RoofGraphEdge[]): ReconPoint[][] {
  if (edges.length < 3 || nodes.length < 3) return []

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const nextMap = buildNextHalfEdgeMap(nodeMap, edges)
  const visited = new Set<string>()
  const faces: ReconPoint[][] = []

  for (const e of edges) {
    for (const start of [
      { from: e.a, to: e.b },
      { from: e.b, to: e.a },
    ] as const) {
      const startKey = halfEdgeKey(start.from, start.to)
      if (visited.has(startKey)) continue

      const poly: ReconPoint[] = []
      let cur = start
      for (let guard = 0; guard < edges.length * 4 + 8; guard++) {
        const curKey = halfEdgeKey(cur.from, cur.to)
        if (visited.has(curKey) && poly.length >= 3) break
        visited.add(curKey)
        const node = nodeMap.get(cur.to)
        if (!node) break
        poly.push({ x: node.x, y: node.y })

        const next = nextMap.get(curKey)
        if (!next) break
        if (next.from === start.from && next.to === start.to) break
        cur = next
      }

      if (poly.length >= 3 && polygonAreaM2(poly) > 1e-6) {
        faces.push(poly)
      }
    }
  }

  return faces
}

/** Drop the outer footprint cycle — largest face in typical roof subdivisions. */
function discardOuterFace(faces: ReconPoint[][], footprint: ReconPoint[]): ReconPoint[][] {
  if (faces.length <= 1) return faces

  const fpArea = polygonAreaM2(footprint)
  let outerIdx = -1
  let maxArea = -1
  for (let i = 0; i < faces.length; i++) {
    const area = polygonAreaM2(faces[i])
    if (area > maxArea) {
      maxArea = area
      outerIdx = i
    }
  }

  if (outerIdx >= 0 && maxArea >= fpArea * 0.85) {
    return faces.filter((_, i) => i !== outerIdx)
  }

  const fpCentroid = polygonCentroid(footprint)
  for (let i = 0; i < faces.length; i++) {
    const c = polygonCentroid(faces[i])
    const probe = {
      x: c.x + (c.x - fpCentroid.x) * 0.05,
      y: c.y + (c.y - fpCentroid.y) * 0.05,
    }
    if (!pointInPolygon(probe, footprint)) {
      return faces.filter((_, idx) => idx !== i)
    }
  }

  return outerIdx >= 0 ? faces.filter((_, i) => i !== outerIdx) : faces
}

function sharedEdgeIndex(a: ReconPoint[], b: ReconPoint[]): number | null {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]
    const a1 = a[(i + 1) % a.length]
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]
      const b1 = b[(j + 1) % b.length]
      if (pointsNear(a0, b1) && pointsNear(a1, b0)) return i
      if (pointsNear(a0, b0) && pointsNear(a1, b1)) return i
    }
  }
  return null
}

function mergeAdjacentPolygons(a: ReconPoint[], b: ReconPoint[]): ReconPoint[] | null {
  const sharedAt = sharedEdgeIndex(a, b)
  if (sharedAt == null) return null

  const merged: ReconPoint[] = []
  for (let i = 0; i < a.length; i++) merged.push(a[(sharedAt + 1 + i) % a.length])
  const bStart = b.findIndex((p) => pointsNear(p, a[(sharedAt + 1) % a.length]))
  if (bStart < 0) return null
  for (let i = 1; i < b.length; i++) merged.push(b[(bStart + i) % b.length])
  return merged.length >= 3 ? merged : null
}

function mergePolygonsForPlane(polys: ReconPoint[][]): ReconPoint[] {
  if (polys.length === 0) return []
  if (polys.length === 1) return polys[0]

  let merged = polys.map((p) => p.map((pt) => ({ ...pt })))
  let changed = true
  while (changed && merged.length > 1) {
    changed = false
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const combo = mergeAdjacentPolygons(merged[i], merged[j])
        if (!combo) continue
        merged.splice(j, 1)
        merged[i] = combo
        changed = true
        break outer
      }
    }
  }

  if (merged.length === 1) return merged[0]
  return merged.reduce((best, p) => (polygonAreaM2(p) > polygonAreaM2(best) ? p : best))
}

function deriveFacetsFromGraphGrid(
  planes: ReconPlane[],
  footprint: ReconPoint[]
): RoofGraphFacet[] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of footprint) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  const grid = new Map<string, number>()
  for (let x = minX + GRID_STEP_M / 2; x <= maxX; x += GRID_STEP_M) {
    for (let y = minY + GRID_STEP_M / 2; y <= maxY; y += GRID_STEP_M) {
      const pt = { x, y }
      if (!pointInPolygon(pt, footprint)) continue
      const owner = lowestPlaneAt(x, y, planes)
      if (owner < 0) continue
      const ix = Math.round((x - minX - GRID_STEP_M / 2) / GRID_STEP_M)
      const iy = Math.round((y - minY - GRID_STEP_M / 2) / GRID_STEP_M)
      grid.set(`${ix},${iy}`, owner)
    }
  }

  const facets: RoofGraphFacet[] = []
  for (let pi = 0; pi < planes.length; pi++) {
    const poly = facetPolygonFromGrid(pi, grid, GRID_STEP_M, minX, minY)
    if (!poly) continue
    const areaSqft = polygonAreaSqft(poly)
    if (areaSqft < MIN_FACET_SQFT) continue
    facets.push({
      id: `f${planes[pi].segment_index}`,
      planeIndex: planes[pi].segment_index,
      polygon: poly,
      areaSqft,
      pitchDegrees: planes[pi].pitch_degrees,
      azimuthDegrees: planes[pi].azimuth_degrees,
    })
  }
  return facets
}

function deriveFacetsFromGraphCycles(
  planes: ReconPlane[],
  nodes: RoofGraphNode[],
  edges: RoofGraphEdge[],
  footprint: ReconPoint[]
): RoofGraphFacet[] {
  const rawFaces = extractCycleFaces(nodes, edges)
  const finiteFaces = discardOuterFace(rawFaces, footprint)

  const byPlane = new Map<number, ReconPoint[][]>()
  for (const poly of finiteFaces) {
    const sample = polygonCentroid(poly)
    if (!pointInPolygon(sample, footprint)) continue
    const owner = lowestPlaneAt(sample.x, sample.y, planes)
    if (owner < 0) continue
    const seg = planes[owner].segment_index
    if (!byPlane.has(seg)) byPlane.set(seg, [])
    byPlane.get(seg)!.push(poly)
  }

  const facets: RoofGraphFacet[] = []
  for (const [seg, polys] of Array.from(byPlane.entries())) {
    const plane = planes.find((p) => p.segment_index === seg)
    if (!plane) continue
    const polygon = mergePolygonsForPlane(polys)
    if (polygon.length < 3) continue
    const areaSqft = polygonAreaSqft(polygon)
    if (areaSqft < MIN_FACET_SQFT) continue
    facets.push({
      id: `f${seg}`,
      planeIndex: seg,
      polygon,
      areaSqft,
      pitchDegrees: plane.pitch_degrees,
      azimuthDegrees: plane.azimuth_degrees,
    })
  }
  return facets
}

export type FacetDerivationMethod = 'cycles' | 'grid'

export function deriveFacetsFromGraphDetailed(
  planes: ReconPlane[],
  nodes: RoofGraphNode[],
  edges: RoofGraphEdge[],
  footprint: ReconPoint[]
): { facets: RoofGraphFacet[]; method: FacetDerivationMethod } {
  if (edges.length < 3) {
    return { facets: deriveFacetsFromGraphGrid(planes, footprint), method: 'grid' }
  }

  const cycleFacets = deriveFacetsFromGraphCycles(planes, nodes, edges, footprint)
  if (cycleFacets.length === 0) {
    return { facets: deriveFacetsFromGraphGrid(planes, footprint), method: 'grid' }
  }

  return { facets: cycleFacets, method: 'cycles' }
}

/** C. Derive facet polygons from constrained graph cycle faces (grid fallback). */
export function deriveFacetsFromGraph(
  planes: ReconPlane[],
  nodes: RoofGraphNode[],
  edges: RoofGraphEdge[],
  footprint: ReconPoint[]
): RoofGraphFacet[] {
  return deriveFacetsFromGraphDetailed(planes, nodes, edges, footprint).facets
}

function polygonIntersectionArea(a: ReconPoint[], b: ReconPoint[]): number {
  let overlap = 0
  const step = 0.5
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of [...a, ...b]) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      const pt = { x, y }
      if (pointInPolygon(pt, a) && pointInPolygon(pt, b)) overlap += step * step
    }
  }
  return overlap * M2_TO_SQFT
}

function circularAzimuthDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

/** True when the verified footprint ring is nearly convex (hull barely larger than ring). */
export function isFootprintConvexish(footprint: ReconPoint[]): boolean {
  if (footprint.length < 3) return false
  const fpArea = polygonAreaSqft(footprint)
  if (fpArea <= 0) return false
  const hullArea = polygonAreaSqft(convexHull(footprint))
  return hullArea / fpArea <= CONVEX_FOOTPRINT_RATIO_MAX
}

/** Lower-envelope grid sample: flat sqft owned by each plane segment_index. */
export function samplePlaneOwnershipSqft(planes: ReconPlane[], footprint: ReconPoint[]): Map<number, number> {
  const owned = new Map<number, number>()
  if (planes.length === 0 || footprint.length < 3) return owned

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of footprint) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  const step = GRID_STEP_M
  const cellSqft = step * step * M2_TO_SQFT
  for (let x = minX + step / 2; x <= maxX; x += step) {
    for (let y = minY + step / 2; y <= maxY; y += step) {
      if (!pointInPolygon({ x, y }, footprint)) continue
      const oi = lowestPlaneAt(x, y, planes)
      if (oi < 0) continue
      const seg = planes[oi].segment_index
      owned.set(seg, (owned.get(seg) ?? 0) + cellSqft)
    }
  }
  return owned
}

/**
 * Expected facet planes from Solar input after azimuth-cluster consolidation:
 * qualifying planes (lower-envelope ownership or Solar ground_area ≥ MIN_FACET_SQFT),
 * grouped by azimuth (≤ AZIMUTH_MERGE_DEG); each cluster counts as one expected face.
 */
export function countExpectedPlanes(
  planes: ReconPlane[],
  footprint: ReconPoint[],
  groundAreaSqftBySegment?: Map<number, number>
): number {
  if (planes.length === 0) return 0
  const ownership = samplePlaneOwnershipSqft(planes, footprint)
  const totalOwned = Array.from(ownership.values()).reduce((sum, sqft) => sum + sqft, 0)
  const relativeMinSqft = totalOwned * NOISE_OWNERSHIP_FRACTION

  type Cluster = { planes: ReconPlane[] }
  const clusters: Cluster[] = []

  for (const plane of planes) {
    const owned = ownership.get(plane.segment_index) ?? 0
    const ground = groundAreaSqftBySegment?.get(plane.segment_index) ?? 0
    if (owned < MIN_FACET_SQFT && ground < MIN_FACET_SQFT) continue
    if (owned < relativeMinSqft) continue

    let cluster = clusters.find((c) =>
      c.planes.some(
        (p) => circularAzimuthDiff(p.azimuth_degrees, plane.azimuth_degrees) <= AZIMUTH_MERGE_DEG
      )
    )
    if (!cluster) {
      cluster = { planes: [] }
      clusters.push(cluster)
    }
    cluster.planes.push(plane)
  }

  return clusters.length
}

function mergeWeightOf(
  p: ReconPlane,
  groundAreaSqftBySegment?: Map<number, number>
): number {
  const ground = groundAreaSqftBySegment?.get(p.segment_index)
  if (ground != null && ground > 0) return ground
  return 1
}

/** Azimuth difference (circular) above which a plane counts as "opposing" for merge height selection. */
const OPPOSING_AZIMUTH_MIN_DEG = 120

function clusterMeanAzimuth(group: ReconPlane[], groundAreaSqftBySegment?: Map<number, number>): number {
  const weightOf = (p: ReconPlane) => mergeWeightOf(p, groundAreaSqftBySegment)
  const totalWeight = group.reduce((sum, p) => sum + weightOf(p), 0)
  const azX = group.reduce(
    (sum, p) => sum + Math.cos((p.azimuth_degrees * Math.PI) / 180) * weightOf(p),
    0
  )
  const azY = group.reduce(
    (sum, p) => sum + Math.sin((p.azimuth_degrees * Math.PI) / 180) * weightOf(p),
    0
  )
  return ((Math.atan2(azY, azX) * 180) / Math.PI + 360) % 360
}

function dominantOpposingPlane(
  plane: ReconPlane,
  allPlanes: ReconPlane[],
  groundAreaSqftBySegment?: Map<number, number>
): ReconPlane | null {
  const opposing = allPlanes.filter(
    (p) =>
      p.segment_index !== plane.segment_index &&
      circularAzimuthDiff(p.azimuth_degrees, plane.azimuth_degrees) >= OPPOSING_AZIMUTH_MIN_DEG
  )
  if (opposing.length === 0) return null
  return opposing.reduce((best, p) =>
    mergeWeightOf(p, groundAreaSqftBySegment) > mergeWeightOf(best, groundAreaSqftBySegment)
      ? p
      : best
  )
}

function azimuthConnectedComponents(planes: ReconPlane[]): ReconPlane[][] {
  const visited = new Set<number>()
  const components: ReconPlane[][] = []
  for (const seed of planes) {
    if (visited.has(seed.segment_index)) continue
    const component: ReconPlane[] = []
    const queue = [seed]
    visited.add(seed.segment_index)
    while (queue.length > 0) {
      const current = queue.pop() as ReconPlane
      component.push(current)
      for (const other of planes) {
        if (visited.has(other.segment_index)) continue
        if (
          circularAzimuthDiff(current.azimuth_degrees, other.azimuth_degrees) <= AZIMUTH_MERGE_DEG
        ) {
          visited.add(other.segment_index)
          queue.push(other)
        }
      }
    }
    components.push(component)
  }
  return components
}

/**
 * Pitch-banding can leave multiple planes in one azimuth cluster. Drop shards that are
 * concave with the dominant opposing face and concave with every ridge-compatible peer
 * in that cluster (Solar mis-reads). Keeps adjacent hip-connected wings (Green seg3).
 */
function dropAzimuthClusterValleyShards(
  merged: ReconPlane[],
  sourcePlanes: ReconPlane[],
  groundAreaSqftBySegment?: Map<number, number>
): ReconPlane[] {
  if (merged.length < 2) return merged

  const isRidgeCandidate = (p: ReconPlane): boolean => {
    const opposing = dominantOpposingPlane(p, sourcePlanes, groundAreaSqftBySegment)
    return opposing != null && isConvexFold(opposing, p)
  }

  const keepSegs = new Set<number>()
  for (const component of azimuthConnectedComponents(merged)) {
    if (component.length === 1) {
      keepSegs.add(component[0].segment_index)
      continue
    }
    const ridgeCandidates = component.filter(isRidgeCandidate)
    if (ridgeCandidates.length === 0) {
      for (const p of component) keepSegs.add(p.segment_index)
      continue
    }
    for (const p of component) {
      if (ridgeCandidates.some((r) => r.segment_index === p.segment_index)) {
        keepSegs.add(p.segment_index)
        continue
      }
      if (ridgeCandidates.some((r) => isConvexFold(p, r) || isConvexFold(r, p))) {
        keepSegs.add(p.segment_index)
      }
    }
  }

  return merged.filter((p) => keepSegs.has(p.segment_index))
}

/** Split a union-find group when transitive pitch links exceed {@link PITCH_MERGE_DEG}. */
function splitGroupByPitchSpread(group: ReconPlane[]): ReconPlane[][] {
  if (group.length <= 1) return [group]
  const sorted = [...group].sort((a, b) => a.pitch_degrees - b.pitch_degrees)
  const subgroups: ReconPlane[][] = []
  let current: ReconPlane[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].pitch_degrees - current[0].pitch_degrees <= PITCH_MERGE_DEG) {
      current.push(sorted[i])
    } else {
      subgroups.push(current)
      current = [sorted[i]]
    }
  }
  subgroups.push(current)
  return subgroups
}

/** Ground-area-weighted merge of a cluster of co-azimuth Solar fragments into one plane. */
function mergePlaneCluster(
  group: ReconPlane[],
  allPlanes: ReconPlane[],
  groundAreaSqftBySegment?: Map<number, number>
): ReconPlane {
  if (group.length === 1) return group[0]

  const groupSegs = new Set(group.map((p) => p.segment_index))
  const clusterAz = clusterMeanAzimuth(group, groundAreaSqftBySegment)
  const opposing = allPlanes.filter(
    (p) =>
      !groupSegs.has(p.segment_index) &&
      circularAzimuthDiff(p.azimuth_degrees, clusterAz) >= OPPOSING_AZIMUTH_MIN_DEG
  )

  let mergeGroup = group
  if (opposing.length > 0) {
    const dominantOpposing = opposing.reduce((best, p) =>
      mergeWeightOf(p, groundAreaSqftBySegment) > mergeWeightOf(best, groundAreaSqftBySegment)
        ? p
        : best
    )
    const convexCompatible = group.filter((p) => isConvexFold(dominantOpposing, p))
    if (convexCompatible.length > 0) mergeGroup = convexCompatible
  }

  const weightOf = (p: ReconPlane) => mergeWeightOf(p, groundAreaSqftBySegment)
  const totalWeight = mergeGroup.reduce((sum, p) => sum + weightOf(p), 0)
  const weightedPitch =
    mergeGroup.reduce((sum, p) => sum + p.pitch_degrees * weightOf(p), 0) / totalWeight
  const azX = mergeGroup.reduce(
    (sum, p) => sum + Math.cos((p.azimuth_degrees * Math.PI) / 180) * weightOf(p),
    0
  )
  const azY = mergeGroup.reduce(
    (sum, p) => sum + Math.sin((p.azimuth_degrees * Math.PI) / 180) * weightOf(p),
    0
  )
  const azimuth = ((Math.atan2(azY, azX) * 180) / Math.PI + 360) % 360
  const cx = mergeGroup.reduce((sum, p) => sum + p.cx * weightOf(p), 0) / totalWeight
  const cy = mergeGroup.reduce((sum, p) => sum + p.cy * weightOf(p), 0) / totalWeight
  const cz =
    mergeGroup.reduce((sum, p) => sum + planeHeightAt(p, cx, cy) * weightOf(p), 0) / totalWeight
  const pRad = (weightedPitch * Math.PI) / 180
  const aRad = (azimuth * Math.PI) / 180
  const nx = Math.sin(pRad) * Math.sin(aRad)
  const ny = Math.sin(pRad) * Math.cos(aRad)
  const nz = Math.cos(pRad)
  const survivor = mergeGroup.reduce((best, p) =>
    weightOf(p) > weightOf(best) ? p : best
  )
  return {
    segment_index: survivor.segment_index,
    azimuth_degrees: azimuth,
    pitch_degrees: weightedPitch,
    nx,
    ny,
    nz,
    d: nx * cx + ny * cy + nz * cz,
    cx,
    cy,
    cz,
  }
}

/**
 * Consolidate over-split Solar planes before graph build (topology path only).
 * Union-find clusters planes when azimuth differs by ≤ {@link AZIMUTH_MERGE_DEG} (circular)
 * AND pitch differs by ≤ {@link PITCH_MERGE_DEG}; each cluster merges into one weighted plane.
 * Opposing faces (~180° apart) never share a cluster; butterfly roofs stay safe.
 */
export function mergeCoplanarTopologyPlanes(
  planes: ReconPlane[],
  groundAreaSqftBySegment?: Map<number, number>
): ReconPlane[] {
  if (planes.length < 2) return planes

  const parent = new Map(planes.map((p) => [p.segment_index, p.segment_index]))
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

  for (let i = 0; i < planes.length; i++) {
    const a = planes[i]
    for (let j = i + 1; j < planes.length; j++) {
      const b = planes[j]
      const azOk =
        circularAzimuthDiff(a.azimuth_degrees, b.azimuth_degrees) <= AZIMUTH_MERGE_DEG
      const pitchOk = Math.abs(a.pitch_degrees - b.pitch_degrees) <= PITCH_MERGE_DEG
      if (azOk && pitchOk) {
        union(a.segment_index, b.segment_index)
      }
    }
  }

  const groups = new Map<number, ReconPlane[]>()
  for (const plane of planes) {
    const root = find(plane.segment_index)
    const group = groups.get(root) ?? []
    group.push(plane)
    groups.set(root, group)
  }

  const pitchSafeGroups = Array.from(groups.values()).flatMap(splitGroupByPitchSpread)
  const merged = pitchSafeGroups.map((group) =>
    mergePlaneCluster(group, planes, groundAreaSqftBySegment)
  )
  return dropAzimuthClusterValleyShards(merged, planes, groundAreaSqftBySegment)
}

/** Drop planes whose lower-envelope footprint ownership is below absolute or relative minimum. */
export function dropTinyTopologyPlanes(planes: ReconPlane[], footprint: ReconPoint[]): ReconPlane[] {
  const ownership = samplePlaneOwnershipSqft(planes, footprint)
  const totalOwned = Array.from(ownership.values()).reduce((sum, sqft) => sum + sqft, 0)
  const relativeMinSqft = totalOwned * NOISE_OWNERSHIP_FRACTION
  return planes.filter((p) => {
    const owned = ownership.get(p.segment_index) ?? 0
    return owned >= MIN_FACET_SQFT && owned >= relativeMinSqft
  })
}

export type ShipConfidenceInput = {
  footprint: ReconPoint[]
  facets: RoofGraphFacet[]
  edges: RoofGraphEdge[]
  planes: ReconPlane[]
  sourcePlanes: ReconPlane[]
  groundAreaSqftBySegment?: Map<number, number>
  ridgeLf: number
  valleyLf: number
  facetCount: number
}

/**
 * Ship-gate confidence checks — bias to force_manual when topology is geometrically valid
 * but inconsistent with Solar plane count or simple convex roof shape.
 */
export function checkShipConfidence(input: ShipConfidenceInput): { ok: boolean; reason: string } {
  const { footprint, edges, planes, ridgeLf, valleyLf, facetCount } = input
  const hasInteriorValley =
    valleyLf > 0 || edges.some((e) => e.planeB != null && e.kind === 'valley')
  const expectedPlanes = countExpectedPlanes(
    input.sourcePlanes,
    footprint,
    input.groundAreaSqftBySegment
  )

  // Convex simple roofs (gable/hip) meet at a ridge, not an interior valley.
  // Butterfly (2 opposing planes) is exempt: only 2 expected planes / 2 facets.
  if (
    isFootprintConvexish(footprint) &&
    hasInteriorValley &&
    ridgeLf === 0 &&
    (expectedPlanes > 2 || facetCount > 2)
  ) {
    return {
      ok: false,
      reason:
        'convex footprint with interior valley and no ridge — likely over-segmented Solar planes',
    }
  }

  // Valley-dominant on a convex multi-plane roof is usually mis-typed ridges (Solar shards).
  // True valleys belong on concave footprints or explicit butterfly (2-plane) cases.
  // Prefer force_manual over shipping under-counted ridge LF (Green/Nottingham failure mode).
  if (
    isFootprintConvexish(footprint) &&
    valleyLf > ridgeLf &&
    (expectedPlanes > 2 || facetCount > 2 || planes.length > 2)
  ) {
    return {
      ok: false,
      reason:
        'convex footprint with valley LF exceeding ridge LF — likely mis-typed interior edges',
    }
  }

  if (expectedPlanes > 0 && facetCount < UNDERSEGMENTATION_RATIO * expectedPlanes) {
    return {
      ok: false,
      reason: `under-segmented: ${facetCount} facets vs ~${expectedPlanes} expected planes from Solar input`,
    }
  }

  return { ok: true, reason: 'confident' }
}

/** D. Topology validation gate. */
export function validateRoofTopology(
  footprint: ReconPoint[],
  facets: RoofGraphFacet[],
  edges: RoofGraphEdge[],
  nodes: RoofGraphNode[]
): { ok: boolean; reason: string } {
  if (facets.length === 0) return { ok: false, reason: 'no facets derived' }

  for (const f of facets) {
    if (!isSimplePolygon(f.polygon)) return { ok: false, reason: `facet ${f.id} is self-intersecting` }
    if (f.areaSqft < MIN_FACET_SQFT) return { ok: false, reason: `facet ${f.id} below minimum area` }
  }

  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const overlap = polygonIntersectionArea(facets[i].polygon, facets[j].polygon)
      const smaller = Math.min(facets[i].areaSqft, facets[j].areaSqft)
      if (smaller > 0 && overlap / smaller > 0.02) {
        return { ok: false, reason: `facets ${facets[i].id} and ${facets[j].id} overlap` }
      }
    }
  }

  const unionSqft = facets.reduce((s, f) => s + f.areaSqft, 0)
  const fpSqft = polygonAreaSqft(footprint)
  const ratio = unionSqft / fpSqft
  if (ratio < 0.92 || ratio > 1.05) {
    return { ok: false, reason: `facet union / footprint ratio ${ratio.toFixed(2)} out of range` }
  }

  for (const e of edges) {
    if (e.planeB != null) {
      if (e.kind !== 'ridge' && e.kind !== 'hip' && e.kind !== 'valley') {
        return { ok: false, reason: `interior edge ${e.id} has invalid kind ${e.kind}` }
      }
    } else if (e.kind !== 'eave' && e.kind !== 'rake') {
      return { ok: false, reason: `exterior edge ${e.id} has invalid kind ${e.kind}` }
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1)
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1)
  }
  for (const e of edges) {
    if (e.planeB == null) continue
    for (const nid of [e.a, e.b]) {
      const pt = nodeMap.get(nid)
      if (!pt) continue
      const onBoundary = pointOnFootprintBoundary(pt, footprint)
      if ((degree.get(nid) ?? 0) < 2 && !onBoundary) {
        return { ok: false, reason: `dangling interior edge at node ${nid}` }
      }
    }
  }

  return { ok: true, reason: 'valid' }
}

function sumEdgeKind(edges: RoofGraphEdge[], kind: RoofEdgeKind): number {
  return Math.round(edges.filter((e) => e.kind === kind).reduce((s, e) => s + e.lengthFt, 0))
}

/**
 * Sloped surface area of the whole roof (materials-relevant).
 * Prefer Σ facet.areaSqft/cos(pitch) when facets cover the footprint (≥92%).
 * When under-segmented, sample the verified footprint on the lower envelope so
 * partial facets cannot collapse the area metric (e.g. Nottingham 2 facets).
 */
function slopedRoofAreaSqft(
  facets: RoofGraphFacet[],
  footprint: ReconPoint[],
  planes: ReconPlane[]
): number {
  const fpFlat = polygonAreaSqft(footprint)
  const facetFlat = facets.reduce((s, f) => s + f.areaSqft, 0)
  const facetSloped = facets.reduce((sum, facet) => {
    const c = Math.max(Math.cos((facet.pitchDegrees * Math.PI) / 180), 0.05)
    return sum + facet.areaSqft / c
  }, 0)
  if (fpFlat > 0 && facetFlat >= 0.92 * fpFlat) return Math.round(facetSloped)

  // Incomplete facet cover — integrate pitch over the footprint via lower envelope.
  if (planes.length === 0 || fpFlat <= 0) return Math.round(facetSloped)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of footprint) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const step = GRID_STEP_M
  const cellSqft = step * step * 10.7639104
  let sloped = 0
  let covered = 0
  for (let x = minX + step / 2; x <= maxX; x += step) {
    for (let y = minY + step / 2; y <= maxY; y += step) {
      if (!pointInPolygon({ x, y }, footprint)) continue
      const oi = lowestPlaneAt(x, y, planes)
      if (oi < 0) continue
      const pitch = planes[oi].pitch_degrees
      const c = Math.max(Math.cos((pitch * Math.PI) / 180), 0.05)
      sloped += cellSqft / c
      covered += cellSqft
    }
  }
  // Grid undersamples boundary — scale to exact footprint flat area.
  if (covered > 0) sloped *= fpFlat / covered
  return Math.round(sloped)
}

function emptyResult(reason: string, footprint: ReconPoint[] = []): RoofTopologyResult {
  return {
    status: 'force_manual',
    reason,
    footprint,
    nodes: [],
    edges: [],
    facets: [],
    totals: {
      ridgeLf: 0,
      hipLf: 0,
      valleyLf: 0,
      eavesLf: 0,
      rakesLf: 0,
      groundSqft: polygonAreaSqft(footprint),
      roofAreaSqft: 0,
      facetCount: 0,
    },
  }
}

/** E. Full topology solve orchestrator. */
export function solveRoofTopology(input: RoofTopologyInput): RoofTopologyResult {
  const verified = verifyFootprint(input.footprint)
  if (!verified.ok) return emptyResult(verified.reason, input.footprint)

  const footprint = verified.ring
  const sourcePlanes = input.sourcePlanes ?? input.planes
  if (input.planes.length < 1) return emptyResult('no planes', footprint)

  const { nodes, edges } = buildConstrainedRoofGraph(input.planes, footprint)
  const facets = deriveFacetsFromGraph(input.planes, nodes, edges, footprint)
  const validation = validateRoofTopology(footprint, facets, edges, nodes)

  const totals = {
    ridgeLf: sumEdgeKind(edges, 'ridge'),
    hipLf: sumEdgeKind(edges, 'hip'),
    valleyLf: sumEdgeKind(edges, 'valley'),
    eavesLf: sumEdgeKind(edges, 'eave'),
    rakesLf: sumEdgeKind(edges, 'rake'),
    groundSqft: Math.round(polygonAreaSqft(footprint)),
    roofAreaSqft: slopedRoofAreaSqft(facets, footprint, input.planes),
    facetCount: facets.length,
  }

  if (!validation.ok) {
    return {
      status: 'force_manual',
      reason: validation.reason,
      footprint,
      nodes,
      edges,
      facets,
      totals,
    }
  }

  const confidence = checkShipConfidence({
    footprint,
    facets,
    edges,
    planes: input.planes,
    sourcePlanes: input.sourcePlanes ?? input.planes,
    groundAreaSqftBySegment: input.groundAreaSqftBySegment,
    ridgeLf: totals.ridgeLf,
    valleyLf: totals.valleyLf,
    facetCount: totals.facetCount,
  })
  if (!confidence.ok) {
    return {
      status: 'force_manual',
      reason: confidence.reason,
      footprint,
      nodes,
      edges,
      facets,
      totals,
    }
  }

  return {
    status: 'ship',
    reason: 'topology valid',
    footprint,
    nodes,
    edges,
    facets,
    totals,
  }
}

function centroidLatLng(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null
  const n = points.length
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  }
}

export function solveRoofTopologyFromSegments(
  segments: Array<{
    segment_index: number
    pitch_degrees: number | null
    azimuth_degrees: number | null
    plane_height_at_center_meters: number | null
    center: LatLng | null
  }>,
  footprintLatLng: LatLng[],
  origin?: LatLng
): RoofTopologyResult | null {
  if (segments.length < 1 || footprintLatLng.length < 3) return null
  const o = origin ?? centroidLatLng(footprintLatLng)
  if (!o) return null
  const mLng = localMetersPerDegLng(o.lat)
  const sourcePlanes: ReconPlane[] = []
  const groundAreaSqftBySegment = new Map<number, number>()
  for (const seg of segments) {
    const pl = buildReconPlane(seg, o)
    if (pl) sourcePlanes.push(pl)
    const groundM2 = (seg as { ground_area_m2?: number | null }).ground_area_m2
    if (groundM2 != null && Number.isFinite(groundM2)) {
      groundAreaSqftBySegment.set(seg.segment_index, groundM2 * M2_TO_SQFT)
    }
  }
  if (sourcePlanes.length < 1) return null
  const footprint = footprintLatLng.map((p) => ({
    x: (p.lng - o.lng) * mLng,
    y: (p.lat - o.lat) * M_PER_DEG_LAT,
  }))
  let planes = mergeCoplanarTopologyPlanes(sourcePlanes, groundAreaSqftBySegment)
  planes = dropTinyTopologyPlanes(planes, footprint)
  if (planes.length < 1) return emptyResult('no planes after consolidation', footprint)
  return solveRoofTopology({ planes, footprint, sourcePlanes, groundAreaSqftBySegment })
}
