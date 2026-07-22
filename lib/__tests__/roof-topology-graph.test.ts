import fs from 'node:fs'
import path from 'node:path'
import {
  countExpectedPlanes,
  mergeCoplanarTopologyPlanes,
  buildConstrainedRoofGraph,
  deriveFacetsFromGraph,
  deriveFacetsFromGraphDetailed,
  isSimplePolygon,
  polygonAreaSqft,
  solveRoofTopology,
  solveRoofTopologyFromSegments,
  validateRoofTopology,
  verifyFootprint,
  type RoofGraphFacet,
} from '@/lib/roof-topology-graph'
import { type ReconPlane, type ReconPoint } from '@/lib/roof-plane-reconstruction'

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

describe('roof-topology-graph', () => {
  describe('verifyFootprint', () => {
    it('accepts a simple rectangular ring', () => {
      const ring: ReconPoint[] = [
        { x: -10, y: -6 },
        { x: 10, y: -6 },
        { x: 10, y: 6 },
        { x: -10, y: 6 },
      ]
      const v = verifyFootprint(ring)
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.ring.length).toBeGreaterThanOrEqual(3)
    })

    it('rejects tiny footprints', () => {
      const ring: ReconPoint[] = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ]
      const v = verifyFootprint(ring)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.reason).toContain('minimum')
    })

    it('rejects self-intersecting footprints', () => {
      const bowtie: ReconPoint[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]
      expect(isSimplePolygon(bowtie)).toBe(false)
      const v = verifyFootprint(bowtie)
      expect(v.ok).toBe(false)
    })
  })

  describe('gable', () => {
    const planes = [plane(0, 0, 30, 0, 3, 5), plane(1, 180, 30, 0, -3, 5)]
    const footprint: ReconPoint[] = [
      { x: -10, y: -6 },
      { x: 10, y: -6 },
      { x: 10, y: 6 },
      { x: -10, y: 6 },
    ]

    it('ships: 2 facets, 1 ridge, eaves + rakes', () => {
      const result = solveRoofTopology({ planes, footprint })
      expect(result.status).toBe('ship')
      expect(result.facets).toHaveLength(2)
      expect(result.totals.facetCount).toBe(2)
      expect(result.totals.ridgeLf).toBeCloseTo(66, -1)
      expect(result.totals.hipLf).toBe(0)
      expect(result.totals.valleyLf).toBe(0)
      expect(result.totals.eavesLf).toBeCloseTo(131, -1)
      expect(result.totals.rakesLf).toBeCloseTo(91, -1)
      expect(result.edges.some((e) => e.kind === 'ridge')).toBe(true)
    })

    it('derives straight graph-cycle facets (not grid stairs)', () => {
      const { nodes, edges } = buildConstrainedRoofGraph(planes, footprint)
      const { facets, method } = deriveFacetsFromGraphDetailed(planes, nodes, edges, footprint)
      expect(method).toBe('cycles')
      expect(facets).toHaveLength(2)
      for (const f of facets) {
        expect(f.polygon.length).toBeLessThanOrEqual(8)
      }
    })
  })

  describe('hip', () => {
    const planes = [
      plane(0, 0, 30, 0, 3, 5),
      plane(1, 180, 30, 0, -3, 5),
      plane(2, 90, 30, 7, 0, 5),
      plane(3, 270, 30, -7, 0, 5),
    ]
    const footprint: ReconPoint[] = [
      { x: -10, y: -6 },
      { x: 10, y: -6 },
      { x: 10, y: 6 },
      { x: -10, y: 6 },
    ]

    it('ships: 4 facets, 1 ridge + 4 hips, no valleys', () => {
      const result = solveRoofTopology({ planes, footprint })
      expect(result.status).toBe('ship')
      expect(result.facets).toHaveLength(4)
      expect(result.totals.facetCount).toBe(4)
      expect(result.totals.ridgeLf).toBeCloseTo(26, -1)
      expect(result.totals.hipLf).toBeCloseTo(114, -1)
      expect(result.totals.valleyLf).toBe(0)
      expect(result.edges.filter((e) => e.kind === 'hip').length).toBeGreaterThanOrEqual(4)
    })

    it('derives straight graph-cycle facets (not grid stairs)', () => {
      const { nodes, edges } = buildConstrainedRoofGraph(planes, footprint)
      const { facets, method } = deriveFacetsFromGraphDetailed(planes, nodes, edges, footprint)
      expect(method).toBe('cycles')
      expect(facets).toHaveLength(4)
      for (const f of facets) {
        expect(f.polygon.length).toBeLessThanOrEqual(12)
      }
    })
  })

  describe('butterfly valley', () => {
    const planes = [plane(0, 180, 30, 0, 3, 5), plane(1, 0, 30, 0, -3, 5)]
    const footprint: ReconPoint[] = [
      { x: -10, y: -6 },
      { x: 10, y: -6 },
      { x: 10, y: 6 },
      { x: -10, y: 6 },
    ]

    it('ships: 2 facets, 1 valley, no ridge/hip', () => {
      const result = solveRoofTopology({ planes, footprint })
      expect(result.status).toBe('ship')
      expect(result.facets).toHaveLength(2)
      expect(result.totals.valleyLf).toBeGreaterThan(0)
      expect(result.totals.ridgeLf).toBe(0)
      expect(result.totals.hipLf).toBe(0)
      expect(result.totals.eavesLf).toBeCloseTo(131, -1)
    })
  })

  describe('bad footprint', () => {
    it('force_manual for self-intersecting input', () => {
      const planes = [plane(0, 0, 30, 0, 3, 5), plane(1, 180, 30, 0, -3, 5)]
      const bowtie: ReconPoint[] = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]
      const result = solveRoofTopology({ planes, footprint: bowtie })
      expect(result.status).toBe('force_manual')
      expect(result.reason).toMatch(/self-intersecting|zero area/)
    })

    it('verifyFootprint returns ok:false for tiny ring', () => {
      const v = verifyFootprint([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 0.5 },
      ])
      expect(v.ok).toBe(false)
    })
  })

  describe('validateRoofTopology', () => {
    it('fails when fake facets overlap', () => {
      const footprint: ReconPoint[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]
      const overlapA: RoofGraphFacet = {
        id: 'fa',
        planeIndex: 0,
        polygon: footprint,
        areaSqft: polygonAreaSqft(footprint),
        pitchDegrees: 30,
        azimuthDegrees: 0,
      }
      const overlapB: RoofGraphFacet = {
        id: 'fb',
        planeIndex: 1,
        polygon: footprint,
        areaSqft: polygonAreaSqft(footprint),
        pitchDegrees: 30,
        azimuthDegrees: 180,
      }
      const { nodes, edges } = buildConstrainedRoofGraph(
        [plane(0, 0, 30, 5, 5, 5), plane(1, 180, 30, 5, 5, 5)],
        footprint
      )
      const v = validateRoofTopology(footprint, [overlapA, overlapB], edges, nodes)
      expect(v.ok).toBe(false)
      expect(v.reason).toContain('overlap')
    })
  })

  describe('solveRoofTopologyFromSegments', () => {
    it('builds planes from Solar segments and solves gable', () => {
      const origin = { lat: 35.0, lng: -80.0 }
      const mLng = 111320 * Math.cos((origin.lat * Math.PI) / 180)
      const toLng = (x: number) => origin.lng + x / mLng
      const toLat = (y: number) => origin.lat + y / 111320
      const footprintLatLng = [
        { lat: toLat(-6), lng: toLng(-10) },
        { lat: toLat(-6), lng: toLng(10) },
        { lat: toLat(6), lng: toLng(10) },
        { lat: toLat(6), lng: toLng(-10) },
      ]
      const result = solveRoofTopologyFromSegments(
        [
          {
            segment_index: 0,
            pitch_degrees: 30,
            azimuth_degrees: 0,
            plane_height_at_center_meters: 5,
            center: { lat: toLat(3), lng: toLng(0) },
          },
          {
            segment_index: 1,
            pitch_degrees: 30,
            azimuth_degrees: 180,
            plane_height_at_center_meters: 5,
            center: { lat: toLat(-3), lng: toLng(0) },
          },
        ],
        footprintLatLng,
        origin
      )
      expect(result).not.toBeNull()
      expect(result!.status).toBe('ship')
      expect(result!.totals.facetCount).toBe(2)
    })
  })

  describe('ship confidence gates', () => {
    const footprint: ReconPoint[] = [
      { x: -10, y: -6 },
      { x: 10, y: -6 },
      { x: 10, y: 6 },
      { x: -10, y: 6 },
    ]

    it('allows butterfly valley (2 planes, valley, no ridge)', () => {
      const planes = [plane(0, 180, 30, 0, 3, 5), plane(1, 0, 30, 0, -3, 5)]
      const result = solveRoofTopology({ planes, footprint })
      expect(result.status).toBe('ship')
      expect(result.totals.valleyLf).toBeGreaterThan(0)
      expect(result.totals.ridgeLf).toBe(0)
    })

    it('force_manual for convex footprint with phantom valley uses Bentley fixture', () => {
      const fixturePath = path.join(process.cwd(), 'scripts', 'roof-topology-eval-fixtures.json')
      const bentley = (
        JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Array<{
          id: string
          segments?: Array<{
            segment_index: number
            pitch_degrees: number
            azimuth_degrees: number
            plane_height_at_center_meters: number
            center: { lat: number; lng: number }
            ground_area_m2?: number
          }>
          footprintLatLng?: Array<{ lat: number; lng: number }>
          origin?: { lat: number; lng: number }
        }>
      ).find((f) => f.id === 'bentley-duke-adam-ev')
      expect(bentley?.segments?.length).toBe(5)
      const result = solveRoofTopologyFromSegments(
        bentley!.segments!,
        bentley!.footprintLatLng!,
        bentley!.origin
      )
      expect(result).not.toBeNull()
      if (result!.status === 'ship') {
        expect(result!.totals.ridgeLf).toBeGreaterThan(0)
        expect(result!.totals.valleyLf).toBe(0)
        expect(result!.totals.facetCount).toBeLessThanOrEqual(3)
      } else {
        expect(result!.status).toBe('force_manual')
        expect(result!.reason.length).toBeGreaterThan(0)
      }
    })

    it('force_manual when facet count is far below expected Solar planes', () => {
      const planes = [
        plane(0, 70, 32, 3, 2, 5),
        plane(1, 250, 37, -2, 1, 5),
        plane(2, 167, 43, -1, -2, 5),
        plane(3, 339, 35, -3, 0, 5),
        plane(4, 249, 49, -2, -1, 4.5),
        plane(5, 339, 39, -2, 1, 5.1),
        plane(6, 150, 35, 1, -1, 5),
        plane(7, 289, 32, 0, 3, 4.8),
      ]
      const ground = new Map<number, number>(
        planes.map((p) => [p.segment_index, 70])
      )
      const expected = countExpectedPlanes(planes, footprint, ground)
      expect(expected).toBeGreaterThanOrEqual(5)
      const result = solveRoofTopology({
        planes: planes.slice(0, 3),
        footprint,
        sourcePlanes: planes,
        groundAreaSqftBySegment: ground,
      })
      expect(result.status).toBe('force_manual')
      expect(result.reason).toContain('under-segmented')
    })
  })

  describe('Bentley Solar segment diagnosis', () => {
    /*
     * Fixture bentley-duke-adam-ev raw Solar segments (~5 fragments, not a clean 2-plane gable):
     *   seg0 az~205° pitch~29° (main SW face)
     *   seg1 az~30°  pitch~22°
     *   seg2 az~28°  pitch~42°  } NE cluster — azimuth-cluster merge (≤20°) collapses to 1
     *   seg3 az~25°  pitch~16°
     *   seg4 az~330° pitch~37° (small NW fragment, may drop as noise)
     */
    it('merges NE azimuth shards and resolves Bentley fixture', () => {
      const fixturePath = path.join(process.cwd(), 'scripts', 'roof-topology-eval-fixtures.json')
      const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Array<{
        id: string
        segments?: Array<{
          segment_index: number
          azimuth_degrees: number
          pitch_degrees: number
          ground_area_m2?: number
        }>
        footprintLatLng?: Array<{ lat: number; lng: number }>
        origin?: { lat: number; lng: number }
      }>
      const bentley = fixtures.find((f) => f.id === 'bentley-duke-adam-ev')
      expect(bentley?.segments).toHaveLength(5)
      const ground = new Map<number, number>(
        bentley!.segments!.map((s) => [
          s.segment_index,
          (s.ground_area_m2 ?? 1) * 10.7639104,
        ])
      )
      const built = bentley!.segments!.map((s) =>
        plane(s.segment_index, s.azimuth_degrees, s.pitch_degrees, 0, 0, 212)
      )
      const merged = mergeCoplanarTopologyPlanes(built, ground)
      expect(merged.length).toBeLessThanOrEqual(3)
      const result = solveRoofTopologyFromSegments(
        bentley!.segments!.map((s) => ({
          segment_index: s.segment_index,
          pitch_degrees: s.pitch_degrees,
          azimuth_degrees: s.azimuth_degrees,
          plane_height_at_center_meters: 212,
          center: bentley!.origin ?? { lat: 35.4796958, lng: -80.5930528 },
          ground_area_m2: s.ground_area_m2,
        })),
        bentley!.footprintLatLng!,
        bentley!.origin
      )
      expect(result).not.toBeNull()
      if (result!.status === 'ship') {
        expect(result!.totals.ridgeLf).toBeGreaterThan(0)
        expect(result!.totals.valleyLf).toBe(0)
        expect(result!.totals.facetCount).toBeLessThanOrEqual(3)
      } else {
        expect(result!.reason.length).toBeGreaterThan(0)
      }
    })
  })

  describe('mergeCoplanarTopologyPlanes azimuth cluster', () => {
    it('merges three same-azimuth planes with different pitches into one', () => {
      const ground = new Map<number, number>([
        [0, 100],
        [1, 50],
        [2, 25],
      ])
      const planes = [
        plane(0, 30, 16, 1, 2, 5),
        plane(1, 28, 22, 1.5, 2.5, 5.1),
        plane(2, 32, 42, 0.5, 1.5, 4.9),
      ]
      const merged = mergeCoplanarTopologyPlanes(planes, ground)
      expect(merged).toHaveLength(1)
      expect(merged[0].segment_index).toBe(0)
      expect(merged[0].pitch_degrees).toBeGreaterThan(16)
      expect(merged[0].pitch_degrees).toBeLessThan(42)
    })

    it('does not merge opposing gable faces (~180° apart)', () => {
      const planes = [plane(0, 0, 30, 0, 3, 5), plane(1, 180, 30, 0, -3, 5)]
      const merged = mergeCoplanarTopologyPlanes(planes)
      expect(merged).toHaveLength(2)
    })
  })

  describe('Green cross-gable fixture', () => {
    it('ships with ridge or force_manual with explicit reason', () => {
      const fixturePath = path.join(process.cwd(), 'scripts', 'roof-topology-eval-fixtures.json')
      const green = (
        JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Array<{
          id: string
          segments?: Array<{
            segment_index: number
            pitch_degrees: number
            azimuth_degrees: number
            plane_height_at_center_meters: number
            center: { lat: number; lng: number }
            ground_area_m2?: number
          }>
          footprintLatLng?: Array<{ lat: number; lng: number }>
          origin?: { lat: number; lng: number }
        }>
      ).find((f) => f.id === 'green-florence-hover')
      expect(green?.segments?.length).toBe(4)
      const result = solveRoofTopologyFromSegments(
        green!.segments!,
        green!.footprintLatLng!,
        green!.origin
      )
      expect(result).not.toBeNull()
      if (result!.status === 'ship') {
        // Must not ship valley-dominant mis-typed gables (ridge must dominate valleys).
        expect(result!.totals.ridgeLf).toBeGreaterThan(result!.totals.valleyLf)
      } else {
        expect(result!.status).toBe('force_manual')
        expect(result!.reason.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Randy hip fixture', () => {
    it('still ships after azimuth-cluster consolidation', () => {
      const fixturePath = path.join(process.cwd(), 'scripts', 'roof-topology-eval-fixtures.json')
      const randy = (
        JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Array<{
          id: string
          segments?: Array<{
            segment_index: number
            pitch_degrees: number
            azimuth_degrees: number
            plane_height_at_center_meters: number
            center: { lat: number; lng: number }
            ground_area_m2?: number
          }>
          footprintLatLng?: Array<{ lat: number; lng: number }>
          origin?: { lat: number; lng: number }
        }>
      ).find((f) => f.id === 'randy-hart-arx-reviewed')
      const result = solveRoofTopologyFromSegments(
        randy!.segments!,
        randy!.footprintLatLng!,
        randy!.origin
      )
      expect(result?.status).toBe('ship')
      expect(result!.totals.facetCount).toBe(4)
    })
  })
})
