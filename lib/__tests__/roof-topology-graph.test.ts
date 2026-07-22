import {
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
})
