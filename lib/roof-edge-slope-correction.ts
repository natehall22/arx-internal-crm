/**
 * Slope-corrects plan-view (satellite footprint) linear footage to true roof-surface
 * lengths, matching how EagleView reports lines off a 3D model.
 *
 * Eaves and ridges are horizontal — plan length already equals true length.
 * Rakes climb their facet's slope: true = plan × pitch multiplier √(1+(r/12)²).
 * Hips/valleys run diagonally between two faces: true = plan × √(1+(tan²A+tan²B)/4)
 * — the standard roofing hip/valley factor (exact for equal pitches meeting at a
 * 90° plan corner, e.g. ×1.061 at 6/12, ×1.106 at 8/12).
 *
 * Applied at measure time only. Saved measurements are snapshots, so records
 * written before this correction keep their original plan-view values.
 */
import type {
  ClassifiedEdge,
  EdgeClassificationResult,
} from './roof-measure-edge-classification'
import type { RoofMeasurePoint } from './roof-measure-geometry'

const M_PER_DEG_LAT = 111320
/** Perpendicular probe distance for locating the facet(s) a drawn line sits on. */
const LINE_PROBE_METERS = 0.8

export type FacetSlopeLookup = Map<string, number>

/** tan²(pitch) from the pitch multiplier (mult = √(1+tan²)). Unset/invalid → 0 (flat). */
export function tanSqFromMultiplier(mult: number | null | undefined): number {
  if (typeof mult !== 'number' || !Number.isFinite(mult) || mult <= 1) return 0
  return mult * mult - 1
}

/** True/plan ratio for a hip or valley between two faces, from their pitch multipliers. */
export function hipValleySlopeFactor(
  multA: number | null | undefined,
  multB: number | null | undefined
): number {
  return Math.sqrt(1 + (tanSqFromMultiplier(multA) + tanSqFromMultiplier(multB)) / 4)
}

/** True/plan ratio for a rake (or any line running straight up a face). */
export function rakeSlopeFactor(mult: number | null | undefined): number {
  return typeof mult === 'number' && Number.isFinite(mult) && mult > 1 ? mult : 1
}

function edgeSlopeFactor(edge: ClassifiedEdge, mults: FacetSlopeLookup): number {
  if (edge.type === 'rake') {
    return rakeSlopeFactor(mults.get(edge.facetIdA))
  }
  if (edge.type === 'hip' || edge.type === 'valley') {
    return hipValleySlopeFactor(
      mults.get(edge.facetIdA),
      edge.facetIdB != null ? mults.get(edge.facetIdB) : mults.get(edge.facetIdA)
    )
  }
  // ridge / eave / unknown: horizontal or indeterminate — leave as measured.
  return 1
}

/**
 * Scale an edge-classification result's LF totals from plan view to true lengths.
 * Ratios are derived per edge type from the classified edge list, then applied to
 * the aggregate totals — this keeps the correction valid for the 2.5D plane path,
 * whose aggregates are overridden separately from `classifiedEdges`.
 */
export function slopeCorrectEdgeTotals(
  result: EdgeClassificationResult,
  mults: FacetSlopeLookup
): EdgeClassificationResult {
  const plan = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 }
  const sloped = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 }

  for (const edge of result.classifiedEdges) {
    if (edge.type === 'unknown') continue
    plan[edge.type] += edge.lengthFt
    sloped[edge.type] += edge.lengthFt * edgeSlopeFactor(edge, mults)
  }

  // The 2.5D plane path can override an aggregate that has no matching 2D edges
  // (plan total 0). Fall back to the roof-average factor so those LF still get
  // corrected instead of silently passing through at plan length.
  const factors = Array.from(mults.values()).filter((m) => Number.isFinite(m) && m >= 1)
  const avgMult = factors.length > 0 ? factors.reduce((s, m) => s + m, 0) / factors.length : 1
  const avgHipValley = hipValleySlopeFactor(avgMult, avgMult)

  const ratio = (type: keyof typeof plan, fallback: number) =>
    plan[type] > 0 ? sloped[type] / plan[type] : fallback

  return {
    ...result,
    hips_lf: Math.round(result.hips_lf * ratio('hip', avgHipValley)),
    valleys_lf: Math.round(result.valleys_lf * ratio('valley', avgHipValley)),
    rakes_lf: Math.round(result.rakes_lf * ratio('rake', avgMult)),
  }
}

// ---------------------------------------------------------------------------
// Manually drawn / AI-loaded polylines (step flashing, valleys, custom runs)
// ---------------------------------------------------------------------------

type LocalPoint = { x: number; y: number }

function toLocalMeters(p: RoofMeasurePoint, origin: RoofMeasurePoint): LocalPoint {
  return {
    x: (p.lng - origin.lng) * M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180),
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  }
}

function pointInPolygonLocal(pt: LocalPoint, poly: LocalPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersects =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function polygonAreaLocal(poly: LocalPoint[]): number {
  let twiceArea = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    twiceArea += poly[j].x * poly[i].y - poly[i].x * poly[j].y
  }
  return Math.abs(twiceArea) / 2
}

export type SlopeFacetPolygon = {
  points: RoofMeasurePoint[]
  pitch_multiplier?: number | null
}

function facetMultiplierAtLocal(
  pt: LocalPoint,
  facets: SlopeFacetPolygon[],
  localPolys: LocalPoint[][]
): number | null {
  let smallestArea = Number.POSITIVE_INFINITY
  let containingMultiplier: number | null = null
  for (let i = 0; i < facets.length; i++) {
    if (localPolys[i].length >= 3 && pointInPolygonLocal(pt, localPolys[i])) {
      const area = polygonAreaLocal(localPolys[i])
      if (area >= smallestArea) continue
      const mult = facets[i].pitch_multiplier
      smallestArea = area
      containingMultiplier =
        typeof mult === 'number' && Number.isFinite(mult) && mult > 1 ? mult : 1
    }
  }
  return containingMultiplier
}

export type SlopedLineType =
  | 'ridge'
  | 'step_flashing'
  | 'wall_flashing'
  | 'valley'
  | 'custom'

/**
 * True roof-surface length of a drawn polyline, in feet.
 *
 * Per segment, the owning facet is probed perpendicular to the segment on both
 * sides (drawn lines usually sit on facet boundaries, so the midpoint itself can
 * fall on either face or neither):
 * - `valley`: hip/valley factor from the two flanking facets.
 * - `step_flashing`: climbs the roof face beside the wall — × that face's multiplier.
 * - `ridge` / `wall_flashing`: horizontal runs — plan length is true length.
 * - `custom`: unknown semantics — left uncorrected.
 * Facets with unset pitch (multiplier ≤ 1) contribute no correction.
 */
export function slopedLengthForLinearFeature(input: {
  type: SlopedLineType
  points: RoofMeasurePoint[]
  planLengthFt: number
  facets: SlopeFacetPolygon[]
  /** Roof-average pitch multiplier, used when no facet contains the line. */
  fallbackMultiplier?: number | null
}): number {
  const { type, points, planLengthFt, facets } = input
  if (planLengthFt <= 0) return 0
  if (type === 'ridge' || type === 'wall_flashing' || type === 'custom') {
    return Math.round(planLengthFt)
  }
  if (points.length < 2 || facets.length === 0) {
    return applyFallback(type, planLengthFt, input.fallbackMultiplier)
  }

  const origin = points[0]
  const localPolys = facets.map((f) => (f.points || []).map((p) => toLocalMeters(p, origin)))
  const localPts = points.map((p) => toLocalMeters(p, origin))
  const totalLen = totalLocalLength(localPts)

  const fallbackMult =
    typeof input.fallbackMultiplier === 'number' &&
    Number.isFinite(input.fallbackMultiplier) &&
    input.fallbackMultiplier > 1
      ? input.fallbackMultiplier
      : 1

  let total = 0
  for (let i = 0; i < localPts.length - 1; i++) {
    const a = localPts[i]
    const b = localPts[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const segLenM = Math.sqrt(dx * dx + dy * dy)
    if (segLenM < 1e-9) continue
    const segPlanFt = (planLengthFt * segLenM) / totalLen

    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const px = (-dy / segLenM) * LINE_PROBE_METERS
    const py = (dx / segLenM) * LINE_PROBE_METERS
    const leftMult = facetMultiplierAtLocal({ x: mid.x + px, y: mid.y + py }, facets, localPolys)
    const rightMult = facetMultiplierAtLocal({ x: mid.x - px, y: mid.y - py }, facets, localPolys)
    const midMult = facetMultiplierAtLocal(mid, facets, localPolys)

    // Segments over untraced roof fall back to the roof-average multiplier.
    let factor: number
    if (type === 'valley') {
      const mA = leftMult ?? midMult ?? rightMult ?? fallbackMult
      const mB = rightMult ?? midMult ?? leftMult ?? fallbackMult
      factor = hipValleySlopeFactor(mA, mB)
    } else {
      factor = rakeSlopeFactor(midMult ?? leftMult ?? rightMult ?? fallbackMult)
    }
    total += segPlanFt * factor
  }

  return Math.round(total)
}

function totalLocalLength(pts: LocalPoint[]): number {
  let len = 0
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.sqrt((pts[i + 1].x - pts[i].x) ** 2 + (pts[i + 1].y - pts[i].y) ** 2)
  }
  return len > 0 ? len : 1
}

function applyFallback(
  type: SlopedLineType,
  planLengthFt: number,
  fallbackMultiplier: number | null | undefined
): number {
  const mult =
    typeof fallbackMultiplier === 'number' && Number.isFinite(fallbackMultiplier) && fallbackMultiplier > 1
      ? fallbackMultiplier
      : 1
  const factor = type === 'valley' ? hipValleySlopeFactor(mult, mult) : mult
  return Math.round(planLengthFt * factor)
}
