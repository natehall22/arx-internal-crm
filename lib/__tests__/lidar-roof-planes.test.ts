import { measureRoofFromLidar, type LocalPoint } from '@/lib/lidar/roof-planes'
import { lidarRoofToEdges, lidarRoofToFacets } from '@/lib/lidar/roof-facets'

// Deterministic jitter so tests are repeatable (lidar ~±3 cm, ~10 pts/m²).
let seed = 7
const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.06
const SPACING = 0.32

/** Sample z(x, y) over a rectangle, keeping points where inside(x, y). */
function sample(x0: number, x1: number, y0: number, y1: number, z: (x: number, y: number) => number): LocalPoint[] {
  const pts: LocalPoint[] = []
  for (let x = x0; x <= x1; x += SPACING) {
    for (let y = y0; y <= y1; y += SPACING) pts.push({ x: x + jitter() * 0.3, y: y + jitter() * 0.3, z: z(x, y) + jitter() })
  }
  return pts
}

const SIX_TWELVE = 0.5 // rise per run
const FT = 3.28084

describe('measureRoofFromLidar', () => {
  it('measures a 6/12 gable: two planes, a level ridge, eaves and rakes', () => {
    // 12 m long (x), 10 m deep (y), ridge along x at y = 0, eaves at y = ±5.
    const pts = sample(-6, 6, -5, 5, (_x, y) => 10 - SIX_TWELVE * Math.abs(y))
    const r = measureRoofFromLidar(pts)!
    expect(r.planes.length).toBe(2)
    for (const p of r.planes) expect(p.pitchDegrees).toBeCloseTo(26.57, 0)
    // 12 × 10 m / cos(26.57°) = 134.2 m² = 14.4 squares; the 0.5 m grid reads edge cells
    // whole, so expect up to ~7% high (deliberately uncorrected — see roof-planes.ts)
    expect(r.totals.squares).toBeGreaterThan(14.0)
    expect(r.totals.squares).toBeLessThan(15.5)
    // ridge 12 m ≈ 39 ft; no hips or valleys
    expect(r.totals.ridgeLf).toBeGreaterThan(35)
    expect(r.totals.ridgeLf).toBeLessThan(43)
    expect(r.totals.hipLf).toBe(0)
    expect(r.totals.valleyLf).toBe(0)
    // eaves 2 × 12 m ≈ 79 ft; rakes 4 × 5 m sloped (5.59 m) ≈ 73 ft
    expect(r.totals.eaveLf).toBeGreaterThan(70)
    expect(r.totals.eaveLf).toBeLessThan(88)
    expect(r.totals.rakeLf).toBeGreaterThan(63)
    expect(r.totals.rakeLf).toBeLessThan(83)
  })

  it('types a hip roof: four planes, a short ridge and four hips', () => {
    // 14 × 10 m hip roof, 6/12 on every side: ridge from x = -2..2 at y = 0.
    const z = (x: number, y: number) => 10 - SIX_TWELVE * Math.max(Math.abs(y), Math.abs(x) - 2)
    const r = measureRoofFromLidar(sample(-7, 7, -5, 5, z))!
    expect(r.planes.length).toBe(4)
    // ridge 4 m ≈ 13 ft
    expect(r.totals.ridgeLf).toBeGreaterThan(8)
    expect(r.totals.ridgeLf).toBeLessThan(18)
    // each hip: 5 m plan diagonal ×√2 = 7.07 m plan, sloped ≈ 7.5 m → 4 hips ≈ 98 ft
    expect(r.totals.hipLf).toBeGreaterThan(85)
    expect(r.totals.hipLf).toBeLessThan(112)
    expect(r.totals.valleyLf).toBe(0)
  })

  it('finds the valleys where a lower wing meets the main roof', () => {
    // Main gable along x (ridge y=0, eaves y=±5, x -8..8); a wing gable along y (ridge x=0,
    // 1 m lower, eaves x=±3) running south to y=-11. The roofs cross where
    // 10-0.5|y| = 9-0.5|x|: two valleys from (0,-2) to (±3,-5), ≈4.2 m plan each.
    const main = (_x: number, y: number) => 10 - SIX_TWELVE * Math.abs(y)
    const wing = (x: number, _y: number) => 9 - SIX_TWELVE * Math.abs(x)
    const inWing = (p: LocalPoint) => Math.abs(p.x) <= 3 && p.y <= 0
    const pts = [
      ...sample(-8, 8, -5, 5, main).filter((p) => !(inWing(p) && wing(p.x, p.y) > main(p.x, p.y))),
      ...sample(-3, 3, -11, 0, wing).filter((p) => p.y < -5 || wing(p.x, p.y) > main(p.x, p.y)),
    ]
    const r = measureRoofFromLidar(pts)!
    expect(r.planes.length).toBe(4)
    // 2 × 4.24 m plan, sloped ×1.06 ≈ 9 m ≈ 30 ft
    expect(r.totals.valleyLf).toBeGreaterThan(22)
    expect(r.totals.valleyLf).toBeLessThan(38)
  })

  it('returns null when there is no building near the pin (built after the survey)', () => {
    const farAway = sample(30, 40, 30, 40, () => 10)
    expect(measureRoofFromLidar(farAway)).toBeNull()
  })

  it('produces tool sections and lines that point at real planes', () => {
    const r = measureRoofFromLidar(sample(-6, 6, -5, 5, (_x, y) => 10 - SIX_TWELVE * Math.abs(y)))!
    const facets = lidarRoofToFacets(r, 35.4, -80.6)
    expect(facets).toHaveLength(2)
    for (const f of facets) {
      expect(f.facet_source).toBe('lidar_plane')
      expect(f.lat_lng_vertices.length).toBeGreaterThanOrEqual(4)
      expect(Math.abs(f.lat_lng_vertices[0].lat - 35.4)).toBeLessThan(0.001)
      expect(f.suggested_pitch_degrees).toBeCloseTo(26.6, 0)
    }
    const ids = new Set(facets.map((f) => f.lidar_plane_id))
    const edges = lidarRoofToEdges(r)
    expect(edges.every((e) => ids.has(e.a) && ids.has(e.b))).toBe(true)
    expect(edges.filter((e) => e.type === 'ridge').reduce((s, e) => s + e.lf, 0) / FT).toBeGreaterThan(10)
  })
})
