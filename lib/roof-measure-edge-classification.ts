// 2D footprint edge classification approximates Aurora roof_summary edge totals when
// facet orientation is consistent; Aurora assigns edge types on a 3D model (SmartRoof / manual).

import { RoofMeasurePoint, haversineDistanceFeet } from './roof-measure-geometry'

export type EdgeType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'unknown'

export interface ClassifiedEdge {
  type: EdgeType
  lengthFt: number
  facetIdA: string
  facetIdB: string | null
}

export interface EdgeClassificationResult {
  ridges_lf: number
  hips_lf: number
  valleys_lf: number
  eaves_lf: number
  rakes_lf: number
  unclassified_shared_lf: number
  classifiedEdges: ClassifiedEdge[]
}

export interface FacetInput {
  id: string
  points: RoofMeasurePoint[]
  /** Panel-facing azimuth (Google Solar). Display only — interior R/H/V use drain azimuth from footprint. */
  facing_azimuth_degrees?: number | null
}

/** ~0.3 m vertex snap for hand-drawn shared edges */
export const SHARED_EDGE_TOLERANCE_DEG = 2.7e-6

/** Gable ridge vs hip: flanking facets ~180° apart → ridge; ~90° → hip */
export const RIDGE_HIP_AZIMUTH_THRESHOLD_DEG = 135

/** Ignore near-parallel slope vs edge (cos ≈ 0.15 ≈ 81°) */
export const MIN_DOT_THRESHOLD = 0.15

/** |dot| below this → rake; else eave on exterior edges */
export const EAVE_RAKE_DOT_THRESHOLD = 0.5

interface PolygonEdge {
  facetId: string
  edgeIdx: number
  p1: RoofMeasurePoint
  p2: RoofMeasurePoint
}

function vec2(from: RoofMeasurePoint, to: RoofMeasurePoint) {
  return { x: to.lng - from.lng, y: to.lat - from.lat }
}

function magnitude(v: { x: number; y: number }) {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

function normalize(v: { x: number; y: number }) {
  const m = magnitude(v)
  if (m < 1e-12) return { x: 0, y: 0 }
  return { x: v.x / m, y: v.y / m }
}

function dot(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x * b.x + a.y * b.y
}

function perpCCW(v: { x: number; y: number }) {
  return { x: -v.y, y: v.x }
}

function midpoint(a: RoofMeasurePoint, b: RoofMeasurePoint): RoofMeasurePoint {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}

function centroidOfPoints(pts: RoofMeasurePoint[]): RoofMeasurePoint {
  const n = pts.length
  return pts.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat / n, lng: acc.lng + p.lng / n }),
    { lat: 0, lng: 0 }
  )
}

function ptsClose(a: RoofMeasurePoint, b: RoofMeasurePoint): boolean {
  return (
    Math.abs(a.lat - b.lat) < SHARED_EDGE_TOLERANCE_DEG &&
    Math.abs(a.lng - b.lng) < SHARED_EDGE_TOLERANCE_DEG
  )
}

/** 0° = drain toward north; 90° = toward east */
function azimuthToVec(azimuthDeg: number) {
  const rad = (azimuthDeg * Math.PI) / 180
  return { x: Math.sin(rad), y: Math.cos(rad) }
}

function vecToAzimuth(v: { x: number; y: number }): number {
  const azimuth = (Math.atan2(v.x, v.y) * 180) / Math.PI
  return (azimuth + 360) % 360
}

function normalizeAngleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

function drainVectorFromLongestEdge(pts: RoofMeasurePoint[]): { x: number; y: number } {
  const n = pts.length
  let longestIdx = 0
  let longestLen = -1
  for (let i = 0; i < n; i++) {
    const len = haversineDistanceFeet(pts[i], pts[(i + 1) % n])
    if (len > longestLen) {
      longestLen = len
      longestIdx = i
    }
  }
  const p1 = pts[longestIdx]
  const p2 = pts[(longestIdx + 1) % n]
  const longestEdgeDir = normalize(vec2(p1, p2))
  const perp = perpCCW(longestEdgeDir)
  const polyCentroid = centroidOfPoints(pts)
  const longestMid = midpoint(p1, p2)
  const towardCentroid = vec2(longestMid, polyCentroid)
  const dotTest = dot(perp, towardCentroid)
  return dotTest < 0 ? perp : { x: -perp.x, y: -perp.y }
}

/**
 * Compass bearing (0–360°) water flows toward, from polygon geometry only.
 * Uses exterior-edge midpoints when sharedEdgeSet + facetId are provided; otherwise
 * treats all edges as exterior. Symmetric footprints fall back to longest-edge perpendicular.
 */
export function computeFacetDrainAzimuth(
  points: RoofMeasurePoint[],
  facetId?: string,
  sharedEdgeSet?: Set<string>
): number {
  if (points.length < 3) return 0

  const id = facetId ?? '__facet'
  const shared = sharedEdgeSet ?? new Set<string>()
  const n = points.length

  const outerMidpoints: RoofMeasurePoint[] = []
  for (let i = 0; i < n; i++) {
    const key = `${id}:${i}`
    if (!shared.has(key)) {
      outerMidpoints.push(midpoint(points[i], points[(i + 1) % n]))
    }
  }

  const polyCentroid = centroidOfPoints(points)
  let drainVec: { x: number; y: number }

  if (outerMidpoints.length > 0) {
    const outerCentroid = centroidOfPoints(outerMidpoints)
    drainVec = normalize(vec2(polyCentroid, outerCentroid))
  } else {
    drainVec = drainVectorFromLongestEdge(points)
  }

  if (magnitude(drainVec) < 1e-9) {
    drainVec = drainVectorFromLongestEdge(points)
  }

  return vecToAzimuth(drainVec)
}

function buildSharedEdgeSet(facets: FacetInput[]): Set<string> {
  const allEdges: PolygonEdge[] = []
  for (const f of facets) {
    const n = f.points.length
    for (let i = 0; i < n; i++) {
      allEdges.push({ facetId: f.id, edgeIdx: i, p1: f.points[i], p2: f.points[(i + 1) % n] })
    }
  }

  const sharedKeys = new Set<string>()
  for (let i = 0; i < allEdges.length; i++) {
    const ea = allEdges[i]
    for (let j = i + 1; j < allEdges.length; j++) {
      const eb = allEdges[j]
      if (ea.facetId === eb.facetId) continue
      const sameDir = ptsClose(ea.p1, eb.p1) && ptsClose(ea.p2, eb.p2)
      const revDir = ptsClose(ea.p1, eb.p2) && ptsClose(ea.p2, eb.p1)
      if (sameDir || revDir) {
        sharedKeys.add(`${ea.facetId}:${ea.edgeIdx}`)
        sharedKeys.add(`${eb.facetId}:${eb.edgeIdx}`)
      }
    }
  }
  return sharedKeys
}

/** Classify a shared edge from facet drain azimuths and edge geometry (also used in tests). */
export function classifySharedEdge(
  p1: RoofMeasurePoint,
  p2: RoofMeasurePoint,
  azimuthA: number,
  azimuthB: number
): EdgeType {
  const edgeVec = normalize(vec2(p1, p2))
  const edgeNormal = perpCCW(edgeVec)
  const slopeA = azimuthToVec(azimuthA)
  const slopeB = azimuthToVec(azimuthB)
  const dotA = dot(slopeA, edgeNormal)
  const dotB = dot(slopeB, edgeNormal)

  if (Math.abs(dotA) < MIN_DOT_THRESHOLD && Math.abs(dotB) < MIN_DOT_THRESHOLD) {
    return 'unknown'
  }
  if (dotA * dotB > 0) {
    return 'valley'
  }
  const azdiff = normalizeAngleDiff(azimuthA, azimuthB)
  return azdiff >= RIDGE_HIP_AZIMUTH_THRESHOLD_DEG ? 'ridge' : 'hip'
}

function azimuthForInteriorEdge(
  facetId: string,
  _facingAzimuths: Map<string, number>,
  drainAzimuths: Map<string, number>
): number {
  const drain = drainAzimuths.get(facetId)
  if (drain != null && Number.isFinite(drain)) return drain
  const facing = _facingAzimuths.get(facetId)
  if (facing != null && Number.isFinite(facing)) return facing
  return 0
}

function classifyInteriorEdge(
  ea: PolygonEdge,
  eb: PolygonEdge,
  facingAzimuths: Map<string, number>,
  drainAzimuths: Map<string, number>
): EdgeType {
  return classifySharedEdge(
    ea.p1,
    ea.p2,
    azimuthForInteriorEdge(ea.facetId, facingAzimuths, drainAzimuths),
    azimuthForInteriorEdge(eb.facetId, facingAzimuths, drainAzimuths)
  )
}

function addInteriorLength(result: EdgeClassificationResult, type: EdgeType, lengthFt: number) {
  if (type === 'ridge') result.ridges_lf += lengthFt
  else if (type === 'hip') result.hips_lf += lengthFt
  else if (type === 'valley') result.valleys_lf += lengthFt
}

export function classifyRoofEdges(facets: FacetInput[]): EdgeClassificationResult {
  const result: EdgeClassificationResult = {
    ridges_lf: 0,
    hips_lf: 0,
    valleys_lf: 0,
    eaves_lf: 0,
    rakes_lf: 0,
    unclassified_shared_lf: 0,
    classifiedEdges: [],
  }

  if (facets.length === 0) return result

  const sharedEdgeSet = buildSharedEdgeSet(facets)

  const drainAzimuths = new Map<string, number>()
  const facingAzimuths = new Map<string, number>()
  for (const f of facets) {
    drainAzimuths.set(f.id, computeFacetDrainAzimuth(f.points, f.id, sharedEdgeSet))
    if (f.facing_azimuth_degrees != null && Number.isFinite(f.facing_azimuth_degrees)) {
      facingAzimuths.set(f.id, ((f.facing_azimuth_degrees % 360) + 360) % 360)
    }
  }

  const processedInterior = new Set<string>()
  const allEdges: PolygonEdge[] = []
  for (const f of facets) {
    const n = f.points.length
    for (let i = 0; i < n; i++) {
      allEdges.push({ facetId: f.id, edgeIdx: i, p1: f.points[i], p2: f.points[(i + 1) % n] })
    }
  }

  for (let i = 0; i < allEdges.length; i++) {
    const ea = allEdges[i]
    const keyA = `${ea.facetId}:${ea.edgeIdx}`
    if (!sharedEdgeSet.has(keyA)) continue
    if (processedInterior.has(keyA)) continue

    let paired = false
    for (let j = i + 1; j < allEdges.length; j++) {
      const eb = allEdges[j]
      if (eb.facetId === ea.facetId) continue
      const keyB = `${eb.facetId}:${eb.edgeIdx}`
      const sameDir = ptsClose(ea.p1, eb.p1) && ptsClose(ea.p2, eb.p2)
      const revDir = ptsClose(ea.p1, eb.p2) && ptsClose(ea.p2, eb.p1)
      if (!sameDir && !revDir) continue

      processedInterior.add(keyA)
      processedInterior.add(keyB)

      const lengthFt = haversineDistanceFeet(ea.p1, ea.p2)
      const type = classifyInteriorEdge(ea, eb, facingAzimuths, drainAzimuths)

      result.classifiedEdges.push({ type, lengthFt, facetIdA: ea.facetId, facetIdB: eb.facetId })
      addInteriorLength(result, type, lengthFt)
      paired = true
      break
    }

    if (!paired) {
      const lengthFt = haversineDistanceFeet(ea.p1, ea.p2)
      result.classifiedEdges.push({
        type: 'unknown',
        lengthFt,
        facetIdA: ea.facetId,
        facetIdB: null,
      })
      result.unclassified_shared_lf += lengthFt
    }
  }

  for (const e of allEdges) {
    const key = `${e.facetId}:${e.edgeIdx}`
    if (sharedEdgeSet.has(key)) continue

    const lengthFt = haversineDistanceFeet(e.p1, e.p2)
    const az = drainAzimuths.get(e.facetId)!
    const slopeVec = azimuthToVec(az)
    const edgeVec = normalize(vec2(e.p1, e.p2))
    const edgeNormal = perpCCW(edgeVec)
    const dotSlope = dot(slopeVec, edgeNormal)

    const type: EdgeType = Math.abs(dotSlope) >= EAVE_RAKE_DOT_THRESHOLD ? 'eave' : 'rake'

    result.classifiedEdges.push({ type, lengthFt, facetIdA: e.facetId, facetIdB: null })
    if (type === 'eave') result.eaves_lf += lengthFt
    if (type === 'rake') result.rakes_lf += lengthFt
  }

  result.ridges_lf = Math.round(result.ridges_lf)
  result.hips_lf = Math.round(result.hips_lf)
  result.valleys_lf = Math.round(result.valleys_lf)
  result.eaves_lf = Math.round(result.eaves_lf)
  result.rakes_lf = Math.round(result.rakes_lf)
  result.unclassified_shared_lf = Math.round(result.unclassified_shared_lf)

  return result
}

export function azimuthToCompassString(azimuth: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round(((azimuth % 360) / 360) * 8) % 8
  return dirs[idx]
}
