/**
 * 2.5D ridge/hip/valley LF from Google Solar plane metadata (pitch + azimuth + planeHeightAtCenterMeters).
 * Supplements 2D `classifyRoofEdges` when USE_PLANE_INTERSECTION_LF is enabled.
 *
 * Plane normal from Solar roofSegmentStats (pitchDegrees, azimuthDegrees):
 * https://developers.google.com/maps/documentation/solar/building-insights
 * planeHeightAtCenterMeters: https://developers.google.com/maps/documentation/solar/reference/rest/v1/buildingInsights/findClosest#RoofSegmentSizeAndSunshineStats
 */
import { haversineDistanceFeet, type RoofMeasurePoint } from './roof-measure-geometry'
import {
  classifyRoofEdges,
  RIDGE_HIP_AZIMUTH_THRESHOLD_DEG,
  SHARED_EDGE_TOLERANCE_DEG,
  type EdgeClassificationResult,
  type EdgeType,
  type FacetInput,
} from './roof-measure-edge-classification'

export type PlaneFacetInput = FacetInput & {
  pitch_degrees?: number | null
  suggested_pitch_degrees?: number | null
  plane_height_at_center_meters?: number | null
  center?: { lat: number; lng: number } | null
}

const M_PER_DEG_LAT = 111320

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

/** Unit normal for a Solar roof plane (azimuth = compass facing, pitch from horizontal). */
export function solarPlaneNormal(pitchDegrees: number, azimuthDegrees: number): [number, number, number] {
  const pitchRad = (pitchDegrees * Math.PI) / 180
  const azRad = (azimuthDegrees * Math.PI) / 180
  const sinP = Math.sin(pitchRad)
  const cosP = Math.cos(pitchRad)
  // Horizontal projection of outward normal follows azimuth (0° = north).
  const nx = sinP * Math.sin(azRad)
  const ny = sinP * Math.cos(azRad)
  const nz = cosP
  return [nx, ny, nz]
}

function facetCenter(f: PlaneFacetInput): RoofMeasurePoint {
  if (f.center && Number.isFinite(f.center.lat) && Number.isFinite(f.center.lng)) {
    return f.center
  }
  const pts = f.points
  if (pts.length === 0) return { lat: 0, lng: 0 }
  return pts.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat / pts.length, lng: acc.lng + p.lng / pts.length }),
    { lat: 0, lng: 0 }
  )
}

function latLngToLocalMeters(p: RoofMeasurePoint, origin: RoofMeasurePoint): [number, number, number] {
  const dy = (p.lat - origin.lat) * M_PER_DEG_LAT
  const dx = (p.lng - origin.lng) * mPerDegLng(origin.lat)
  return [dx, dy, 0]
}

function planeFromSolarFacet(f: PlaneFacetInput, origin: RoofMeasurePoint): [number, number, number, number] | null {
  const pitch =
    typeof f.pitch_degrees === 'number' && f.pitch_degrees > 0
      ? f.pitch_degrees
      : typeof f.suggested_pitch_degrees === 'number'
        ? f.suggested_pitch_degrees
        : null
  const az = f.facing_azimuth_degrees
  if (pitch == null || az == null || !Number.isFinite(pitch) || !Number.isFinite(az)) return null

  const [nx, ny, nz] = solarPlaneNormal(pitch, az)
  const center = facetCenter(f)
  const [cx, cy] = latLngToLocalMeters(center, origin)
  const cz =
    typeof f.plane_height_at_center_meters === 'number' && Number.isFinite(f.plane_height_at_center_meters)
      ? f.plane_height_at_center_meters
      : 0
  const d = nx * cx + ny * cy + nz * cz
  return [nx, ny, nz, d]
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dihedralAngleDeg(n1: [number, number, number], n2: [number, number, number]): number {
  const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
  const clamped = Math.max(-1, Math.min(1, dot))
  return (Math.acos(clamped) * 180) / Math.PI
}

function normalizeAngleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

function facetFacingAzimuth(f: PlaneFacetInput): number | null {
  const az = f.facing_azimuth_degrees
  if (az == null || !Number.isFinite(az)) return null
  return ((az % 360) + 360) % 360
}

/**
 * Ridge/hip/valley from plane normals plus Solar facet azimuths.
 * Normal angle alone is ambiguous (~2×pitch for both ridge and hip corners); azimuth
 * separation disambiguates opposing facets (ridge) vs perpendicular (hip) vs parallel (valley).
 */
function classifySharedEdgeFromPlanes(
  azimuthA: number | null,
  azimuthB: number | null,
  n1: [number, number, number],
  n2: [number, number, number]
): EdgeType {
  const angle = dihedralAngleDeg(n1, n2)

  if (azimuthA != null && azimuthB != null) {
    const azDiff = normalizeAngleDiff(azimuthA, azimuthB)
    if (angle < 25) return 'valley'
    if (azDiff >= RIDGE_HIP_AZIMUTH_THRESHOLD_DEG) return 'ridge'
    if (azDiff >= 45 && azDiff <= 135) return 'hip'
  }

  // Fallback when azimuth missing: coarse normal-angle buckets (legacy thresholds, fixed).
  if (angle < 25) return 'valley'
  if (angle >= 110) return 'ridge'
  if (angle >= 45 && angle <= 100) return 'hip'
  return 'valley'
}

function edgesMatch(a1: RoofMeasurePoint, a2: RoofMeasurePoint, b1: RoofMeasurePoint, b2: RoofMeasurePoint): boolean {
  const tol = SHARED_EDGE_TOLERANCE_DEG
  const eq = (p: RoofMeasurePoint, q: RoofMeasurePoint) =>
    Math.abs(p.lat - q.lat) <= tol && Math.abs(p.lng - q.lng) <= tol
  return (eq(a1, b1) && eq(a2, b2)) || (eq(a1, b2) && eq(a2, b1))
}

function sharedEdgeMidpoint(f1: PlaneFacetInput, f2: PlaneFacetInput): RoofMeasurePoint | null {
  const p1 = f1.points
  const p2 = f2.points
  for (let i = 0; i < p1.length; i++) {
    const a1 = p1[i]
    const a2 = p1[(i + 1) % p1.length]
    for (let j = 0; j < p2.length; j++) {
      const b1 = p2[j]
      const b2 = p2[(j + 1) % p2.length]
      if (edgesMatch(a1, a2, b1, b2)) {
        return { lat: (a1.lat + a2.lat + b1.lat + b2.lat) / 4, lng: (a1.lng + a2.lng + b1.lng + b2.lng) / 4 }
      }
    }
  }
  return null
}

/**
 * Classify shared interior edges using plane dihedral angle:
 * ~180° → ridge, ~90° → hip, acute reflex → valley (approximation).
 */
export function classifyRoofEdgesFromPlanes(facets: PlaneFacetInput[]): EdgeClassificationResult {
  const base = classifyRoofEdges(facets)
  if (facets.length < 2) return base

  const origin = facetCenter(facets[0])
  const planes = facets.map((f) => planeFromSolarFacet(f, origin))
  let ridges = 0
  let hips = 0
  let valleys = 0

  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const p1 = planes[i]
      const p2 = planes[j]
      if (!p1 || !p2) continue
      const mid = sharedEdgeMidpoint(facets[i], facets[j])
      if (!mid) continue

      const n1: [number, number, number] = [p1[0], p1[1], p1[2]]
      const n2: [number, number, number] = [p2[0], p2[1], p2[2]]
      const edgeType = classifySharedEdgeFromPlanes(
        facetFacingAzimuth(facets[i]),
        facetFacingAzimuth(facets[j]),
        n1,
        n2
      )

      let sharedLen = 0
      const ptsA = facets[i].points
      const ptsB = facets[j].points
      for (let a = 0; a < ptsA.length; a++) {
        const e1 = ptsA[a]
        const e2 = ptsA[(a + 1) % ptsA.length]
        for (let b = 0; b < ptsB.length; b++) {
          const f1 = ptsB[b]
          const f2 = ptsB[(b + 1) % ptsB.length]
          if (edgesMatch(e1, e2, f1, f2)) {
            sharedLen = haversineDistanceFeet(e1, e2)
            break
          }
        }
        if (sharedLen > 0) break
      }
      if (sharedLen <= 0) continue

      if (edgeType === 'ridge') ridges += sharedLen
      else if (edgeType === 'hip') hips += sharedLen
      else if (edgeType === 'valley') valleys += sharedLen
    }
  }

  if (ridges + hips + valleys <= 0) return base

  return {
    ...base,
    ridges_lf: Math.round(ridges),
    hips_lf: Math.round(hips),
    valleys_lf: Math.round(valleys),
  }
}

/** When flag on, use plane LF only if it produces non-zero interior edges. */
export function classifyRoofEdgesWithOptionalPlanes(
  facets: PlaneFacetInput[],
  usePlaneIntersection: boolean
): EdgeClassificationResult {
  const planar2d = classifyRoofEdges(facets)
  if (!usePlaneIntersection) return planar2d
  const planar25d = classifyRoofEdgesFromPlanes(facets)
  const interior25 =
    planar25d.ridges_lf + planar25d.hips_lf + planar25d.valleys_lf
  const interior2d = planar2d.ridges_lf + planar2d.hips_lf + planar2d.valleys_lf
  if (interior25 <= 0) return planar2d
  if (interior2d > 0 && interior25 > interior2d * 1.35) return planar2d
  return planar25d
}
