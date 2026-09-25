/**
 * A drawn ridge/hip/valley line supersedes the auto-classified edges it lies on.
 *
 * Auto classification splits ridge from hip using footprint-derived drain azimuths, which is the
 * weak part of the measure (it reads a main ridge as a hip). Reps fix that by drawing the line —
 * but a drawn line is only ADDED to the totals, so the auto edge it lies on stayed counted too.
 * Ridge/hip cap LF (and valley LF) came out double on any roof with drawn lines.
 *
 * Convex lines (ridge, hip) supersede convex auto edges (ridge, hip); a valley line supersedes
 * auto valleys. Ridge-vs-valley is never crossed: a line contradicting the concave/convex call is
 * far more likely a stray line near a junction than a real reclassification.
 */
import type {
  ClassifiedEdge,
  EdgeClassificationResult,
  EdgeType,
} from './roof-measure-edge-classification'
import {
  slopeCorrectEdgeTotals,
  toLocalMeters,
  type FacetSlopeLookup,
  type LocalPoint,
} from './roof-edge-slope-correction'
import type { RoofMeasurePoint } from './roof-measure-geometry'

export interface DrawnInteriorLine {
  type: string
  points: RoofMeasurePoint[]
}

/** How far (m) a drawn line may sit from an auto edge and still count as lying on it. */
export const DRAWN_LINE_COVER_TOLERANCE_M = 1.0
/** |cos| of the angle between line and edge must be at least this (≈ within 26°). */
export const DRAWN_LINE_COVER_MIN_PARALLEL = 0.9
const SAMPLE_STEP_M = 0.5

const CONVEX: readonly EdgeType[] = ['ridge', 'hip']
const CONCAVE: readonly EdgeType[] = ['valley']

const isConvexLine = (t: string) => t === 'ridge' || t === 'hip'

/** Fraction of `edge` (0–1) that lies along any of `lines`, near and roughly parallel. */
function coveredFraction(
  edge: { a: LocalPoint; b: LocalPoint },
  lines: LocalPoint[][],
  tolM: number,
  minParallel: number
): number {
  const dx = edge.b.x - edge.a.x
  const dy = edge.b.y - edge.a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return 0
  const ex = dx / len
  const ey = dy / len
  const n = Math.max(2, Math.ceil(len / SAMPLE_STEP_M))
  let covered = 0
  for (let s = 0; s < n; s++) {
    const t = (s + 0.5) / n
    const px = edge.a.x + dx * t
    const py = edge.a.y + dy * t
    let hit = false
    for (const line of lines) {
      for (let k = 0; k + 1 < line.length && !hit; k++) {
        const a = line[k]
        const b = line[k + 1]
        const sx = b.x - a.x
        const sy = b.y - a.y
        const l2 = sx * sx + sy * sy
        if (l2 < 1e-12) continue
        const u = Math.max(0, Math.min(1, ((px - a.x) * sx + (py - a.y) * sy) / l2))
        if (Math.hypot(px - (a.x + u * sx), py - (a.y + u * sy)) > tolM) continue
        const sl = Math.sqrt(l2)
        if (Math.abs((sx / sl) * ex + (sy / sl) * ey) >= minParallel) hit = true
      }
      if (hit) break
    }
    if (hit) covered++
  }
  return covered / n
}

/**
 * Auto ridge/hip/valley LF that drawn lines already account for, slope-corrected the same way as
 * the auto totals. Subtract this from the auto totals, then add the drawn lines' own LF.
 * Edges without endpoints (anything not produced by the 2D classifier, e.g. the staged 2.5D plane
 * path) can't be matched and are left uncovered.
 */
export function coveredAutoLf(input: {
  result: EdgeClassificationResult
  lines: DrawnInteriorLine[]
  mults: FacetSlopeLookup
  toleranceM?: number
  minParallel?: number
}): { ridges_lf: number; hips_lf: number; valleys_lf: number } {
  const { result, mults } = input
  const tolM = input.toleranceM ?? DRAWN_LINE_COVER_TOLERANCE_M
  const minParallel = input.minParallel ?? DRAWN_LINE_COVER_MIN_PARALLEL
  const lines = input.lines.filter(
    (l) =>
      Array.isArray(l.points) &&
      l.points.length >= 2 &&
      (isConvexLine(l.type) || l.type === 'valley')
  )
  if (lines.length === 0) return { ridges_lf: 0, hips_lf: 0, valleys_lf: 0 }

  const origin = lines[0].points[0]
  const localLines = (pick: (type: string) => boolean) =>
    lines.filter((l) => pick(l.type)).map((l) => l.points.map((p) => toLocalMeters(p, origin)))
  const convexLines = localLines(isConvexLine)
  const concaveLines = localLines((t) => t === 'valley')

  const coveredEdges: ClassifiedEdge[] = []
  for (const edge of result.classifiedEdges) {
    if (edge.p1 == null || edge.p2 == null) continue
    const set = CONVEX.includes(edge.type) ? convexLines : CONCAVE.includes(edge.type) ? concaveLines : null
    if (!set || set.length === 0) continue
    const f = coveredFraction(
      { a: toLocalMeters(edge.p1, origin), b: toLocalMeters(edge.p2, origin) },
      set,
      tolM,
      minParallel
    )
    if (f > 0) coveredEdges.push({ ...edge, lengthFt: edge.lengthFt * f })
  }

  // Totals come from the covered slices alone: the 2.5D plane path overrides `result`'s aggregates,
  // so differencing against them would not be comparable.
  const covered: EdgeClassificationResult = {
    ...result,
    classifiedEdges: coveredEdges,
    ridges_lf: 0,
    hips_lf: 0,
    valleys_lf: 0,
  }
  for (const e of coveredEdges) {
    if (e.type === 'ridge') covered.ridges_lf += e.lengthFt
    else if (e.type === 'hip') covered.hips_lf += e.lengthFt
    else if (e.type === 'valley') covered.valleys_lf += e.lengthFt
  }
  covered.ridges_lf = Math.round(covered.ridges_lf)
  covered.hips_lf = Math.round(covered.hips_lf)
  covered.valleys_lf = Math.round(covered.valleys_lf)

  const sloped = slopeCorrectEdgeTotals(covered, mults)
  return { ridges_lf: sloped.ridges_lf, hips_lf: sloped.hips_lf, valleys_lf: sloped.valleys_lf }
}

export interface InteriorLf {
  ridges_lf: number
  hips_lf: number
  valleys_lf: number
}

/**
 * Final ridge/hip/valley LF from the auto totals, what drawn lines already account for, and the
 * drawn lines' own LF. Drawn ridge lines stay the full ridge set (long-standing behaviour); hips
 * and valleys keep any auto edge no drawn line lies on, so a partly drawn roof isn't under-counted.
 */
export function mergeDrawnAndAutoLf(input: {
  auto: InteriorLf
  covered: InteriorLf
  drawn: InteriorLf
}): InteriorLf {
  const { auto, covered, drawn } = input
  return {
    ridges_lf:
      drawn.ridges_lf > 0
        ? Math.round(drawn.ridges_lf)
        : Math.max(0, auto.ridges_lf - covered.ridges_lf),
    hips_lf: Math.max(0, auto.hips_lf - covered.hips_lf) + Math.round(drawn.hips_lf),
    valleys_lf: Math.max(0, auto.valleys_lf - covered.valleys_lf) + Math.round(drawn.valleys_lf),
  }
}
