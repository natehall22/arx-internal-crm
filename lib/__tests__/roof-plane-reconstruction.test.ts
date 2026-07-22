import {
  type ReconPlane,
  classifyReconEdge,
  convexHull,
  isConvexFold,
  measureFacetLocalEdges,
  measureReconstructedEdges,
  reconstructRoofLf,
  reconstructSharedEdges,
  sharedEdgeLine,
  straightenPolygon,
} from '@/lib/roof-plane-reconstruction'

/** Build a plane directly in local meters from azimuth/pitch/center (mirrors buildReconPlane). */
function plane(
  segment_index: number,
  az: number,
  pitchDeg: number,
  cx: number,
  cy: number,
  cz: number
): ReconPlane {
  const p = (pitchDeg * Math.PI) / 180
  const a = (az * Math.PI) / 180
  const nx = Math.sin(p) * Math.sin(a)
  const ny = Math.sin(p) * Math.cos(a)
  const nz = Math.cos(p)
  return {
    segment_index,
    azimuth_degrees: az,
    pitch_degrees: pitchDeg,
    nx,
    ny,
    nz,
    d: nx * cx + ny * cy + nz * cz,
    cx,
    cy,
    cz,
  }
}

describe('roof-plane-reconstruction', () => {
  it('classifies opposing planes as a ridge running perpendicular to their slopes', () => {
    const n = plane(0, 0, 30, 0, 3, 5)
    const s = plane(1, 180, 30, 0, -3, 5)
    expect(classifyReconEdge(n, s)).toBe('ridge')
    const line = sharedEdgeLine(n, s)!
    // z_n = z_s along y = 0 -> the ridge runs E-W (direction ±x).
    expect(Math.abs(line.dirY)).toBeLessThan(1e-6)
    expect(Math.abs(line.dirX)).toBeCloseTo(1, 6)
  })

  it('classifies ~90° adjacent planes as a hip on a diagonal', () => {
    const n = plane(0, 0, 30, 0, 3, 5)
    const e = plane(1, 90, 30, 3, 0, 5)
    expect(classifyReconEdge(n, e)).toBe('hip')
    const line = sharedEdgeLine(n, e)!
    expect(Math.abs(line.dirX)).toBeCloseTo(Math.abs(line.dirY), 6) // 45° diagonal
  })

  it('classifies inward-facing (butterfly) planes as a valley despite 180° azimuth', () => {
    const a = plane(0, 90, 30, -2, 0, 5) // faces E, rises to W
    const b = plane(1, 270, 30, 2, 0, 5) // faces W, rises to E
    expect(isConvexFold(a, b)).toBe(false)
    expect(classifyReconEdge(a, b)).toBe('valley')
  })

  it('reconstructs a rectangular hip roof as one ridge + four hips (opposite ends excluded)', () => {
    const planes = [
      plane(0, 0, 30, 0, 3, 5), // N
      plane(1, 180, 30, 0, -3, 5), // S
      plane(2, 90, 30, 7, 0, 5), // E
      plane(3, 270, 30, -7, 0, 5), // W
    ]
    const edges = reconstructSharedEdges(planes, { maxCenterMeters: 10 })
    expect(edges.filter((e) => e.type === 'ridge')).toHaveLength(1) // N∩S
    expect(edges.filter((e) => e.type === 'hip')).toHaveLength(4) // N∩E, N∩W, S∩E, S∩W
    // E∩W centers are 14 m apart → not adjacent, must be excluded.
    expect(edges.some((e) => (e.a === 2 && e.b === 3) || (e.a === 3 && e.b === 2))).toBe(false)
  })

  it('measures a synthetic gable: full-length ridge, long eaves, gable-end rakes, no hips', () => {
    // Two opposing planes over a 20 m × 12 m rectangle → gable ridge down the middle.
    const planes = [plane(0, 0, 30, 0, 3, 5), plane(1, 180, 30, 0, -3, 5)]
    const footprint = [
      { x: -10, y: -6 },
      { x: 10, y: -6 },
      { x: 10, y: 6 },
      { x: -10, y: 6 },
    ]
    const m = measureReconstructedEdges(planes, footprint)
    expect(m.ridgeLf).toBeCloseTo(66, -1) // 20 m span ≈ 65.6 ft
    expect(m.hipLf).toBe(0)
    expect(m.valleyLf).toBe(0)
    expect(m.eavesLf).toBeCloseTo(131, -1) // two 20 m level eaves (no slope correction)
    expect(m.rakesLf).toBeCloseTo(91, -1) // two 12 m gable ends, slope-corrected up the 30° pitch
  })

  it('measures a butterfly valley: valley LF, eaves on long sides, no ridge/hip', () => {
    // Both facets slope down toward the E-W valley at y=0 (concave fold).
    const planes = [plane(0, 180, 30, 0, 3, 5), plane(1, 0, 30, 0, -3, 5)]
    expect(classifyReconEdge(planes[0], planes[1])).toBe('valley')
    const north = [
      { x: -10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: -10, y: 6 },
    ]
    const south = [
      { x: -10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: -6 },
      { x: -10, y: -6 },
    ]
    const m = measureFacetLocalEdges(planes, [north, south])
    expect(m.valleyLf).toBeGreaterThan(0)
    expect(m.ridgeLf).toBe(0)
    expect(m.hipLf).toBe(0)
    // Two 20 m eaves on north and south long sides (short ends may read as rakes).
    expect(m.eavesLf).toBeCloseTo(131, -1)
  })

  it('measures an L-shaped roof with valley corridor — no phantom eave across the notch', () => {
    // Classic L: west wing + east wing share a corridor along x=0, y∈[0,6].
    // Symmetric centers (±4) put the geometric valley exactly on that shared edge.
    const planes = [plane(0, 90, 30, -4, 3, 5), plane(1, 270, 30, 4, 3, 5)]
    expect(isConvexFold(planes[0], planes[1])).toBe(false)
    const westWing = [
      { x: -8, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 12 },
      { x: -8, y: 12 },
    ]
    const eastWing = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 6 },
      { x: 0, y: 6 },
    ]
    const local = measureFacetLocalEdges(planes, [westWing, eastWing])
    expect(local.valleyLf).toBeGreaterThan(0)
    expect(local.ridgeLf).toBe(0)
    // Shared corridor is 6 m ≈ 19.7 ft plan; slope-corrected valley should land near that band.
    expect(local.valleyLf).toBeGreaterThan(15)
    expect(local.valleyLf).toBeLessThan(35)

    // Convex hull fills the reentrant notch — overcovers facet area by >12%.
    const hull = convexHull([...westWing, ...eastWing])
    const hullArea = Math.abs(
      hull.reduce((s, p, i) => {
        const q = hull[(i + 1) % hull.length]
        return s + p.x * q.y - q.x * p.y
      }, 0) / 2
    )
    const facetArea =
      Math.abs(
        westWing.reduce((s, p, i) => {
          const q = westWing[(i + 1) % westWing.length]
          return s + p.x * q.y - q.x * p.y
        }, 0) / 2
      ) +
      Math.abs(
        eastWing.reduce((s, p, i) => {
          const q = eastWing[(i + 1) % eastWing.length]
          return s + p.x * q.y - q.x * p.y
        }, 0) / 2
      )
    expect(hullArea / facetArea).toBeGreaterThan(1.12)

    // Facet-local exterior follows the true L perimeter (no invented edge across the void).
    const exterior = local.eavesLf + local.rakesLf
    expect(exterior).toBeGreaterThan(0)
    expect(exterior).toBeLessThan(300)
  })

  it('straightenPolygon snaps a jagged rectangle toward axis-aligned edges', () => {
    const jagged = [
      { x: 0, y: 0 },
      { x: 10.2, y: 0.15 },
      { x: 10.1, y: 5.05 },
      { x: -0.1, y: 4.95 },
    ]
    const straight = straightenPolygon(jagged)
    expect(straight.length).toBe(4)
    for (let i = 0; i < straight.length; i++) {
      const p = straight[i]
      const q = straight[(i + 1) % straight.length]
      const dx = q.x - p.x
      const dy = q.y - p.y
      const angleDeg = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI
      const nearAxis =
        angleDeg < 5 || Math.abs(angleDeg - 90) < 5 || Math.abs(angleDeg - 180) < 5
      expect(nearAxis).toBe(true)
    }
  })

  it('reconstructRoofLf returns reliable=true for synthetic butterfly valley facets', () => {
    const origin = { lat: 35.0, lng: -80.0 }
    const mLng = 111320 * Math.cos((origin.lat * Math.PI) / 180)
    const toLng = (x: number) => origin.lng + x / mLng
    const toLat = (y: number) => origin.lat + y / 111320
    const rect = (x0: number, y0: number, x1: number, y1: number) => [
      { lat: toLat(y0), lng: toLng(x0) },
      { lat: toLat(y0), lng: toLng(x1) },
      { lat: toLat(y1), lng: toLng(x1) },
      { lat: toLat(y1), lng: toLng(x0) },
    ]
    const result = reconstructRoofLf([
      {
        points: rect(-10, 0, 10, 6),
        pitch_degrees: 30,
        facing_azimuth_degrees: 180,
        plane_height_at_center_meters: 5,
        center: { lat: toLat(3), lng: toLng(0) },
      },
      {
        points: rect(-10, -6, 10, 0),
        pitch_degrees: 30,
        facing_azimuth_degrees: 0,
        plane_height_at_center_meters: 5,
        center: { lat: toLat(-3), lng: toLng(0) },
      },
    ])
    expect(result).not.toBeNull()
    expect(result!.reliable).toBe(true)
    expect(result!.valleyLf).toBeGreaterThan(0)
    expect(result!.reason).toContain('facet-local valley/concave')
  })
})
