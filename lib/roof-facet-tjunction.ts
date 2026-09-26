/**
 * Split facet edges where a neighbor's vertex lies on them (T-junctions).
 *
 * `classifyRoofEdges` pairs interior edges only when BOTH endpoints match a
 * neighbor's edge. Hand-drawn roofs rarely line up like that: a rep ends one
 * facet's corner partway along the next facet's edge, so the shared stretch is
 * never paired — it is counted as an eave/rake on each side and its ridge, hip or
 * valley LF is lost. Inserting the neighbor's vertex into the edge (using the
 * neighbor's exact coordinate) turns the T-junction into matching sub-edges.
 *
 * Area is effectively unchanged: every inserted vertex lies within `toleranceM`
 * of the existing edge. Eval-only for now — see lib/roof-facet-dsm-plane.ts.
 */
import type { RoofMeasurePoint } from './roof-measure-geometry'

const M_PER_DEG_LAT = 111_320

/** Matches SHARED_EDGE_TOLERANCE_DEG (~0.3 m) used for endpoint pairing. */
export const TJUNCTION_TOLERANCE_M = 0.3

export function splitFacetEdgesAtTJunctions<T extends { id: string; points: RoofMeasurePoint[] }>(
  facets: T[],
  toleranceM = TJUNCTION_TOLERANCE_M
): T[] {
  if (facets.length < 2) return facets
  const lat0 = facets[0].points[0]?.lat ?? 0
  const mLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  const xy = (p: RoofMeasurePoint) => ({ x: p.lng * mLng, y: p.lat * M_PER_DEG_LAT })

  return facets.map((facet) => {
    const others = facets.filter((o) => o.id !== facet.id).flatMap((o) => o.points)
    const pts = facet.points
    const out: RoofMeasurePoint[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      out.push(a)
      const A = xy(a)
      const B = xy(b)
      const dx = B.x - A.x
      const dy = B.y - A.y
      const len = Math.hypot(dx, dy)
      if (len < 2 * toleranceM) continue
      const onEdge: { t: number; p: RoofMeasurePoint }[] = []
      for (const q of others) {
        const Q = xy(q)
        const t = ((Q.x - A.x) * dx + (Q.y - A.y) * dy) / (len * len)
        // Strictly inside the edge, clear of both endpoints.
        if (t * len <= toleranceM || (1 - t) * len <= toleranceM) continue
        const dist = Math.abs((Q.x - A.x) * dy - (Q.y - A.y) * dx) / len
        if (dist > toleranceM) continue
        if (onEdge.some((e) => Math.abs(e.t - t) * len <= toleranceM)) continue
        onEdge.push({ t, p: q })
      }
      onEdge.sort((m, n) => m.t - n.t)
      for (const e of onEdge) out.push(e.p)
    }
    return out.length === pts.length ? facet : { ...facet, points: out }
  })
}
