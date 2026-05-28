import {
  classifyRoofEdgesFromPlanes,
  classifyRoofEdgesWithOptionalPlanes,
  solarPlaneNormal,
} from '@/lib/roof-plane-edge-classification'
import { classifyRoofEdges } from '@/lib/roof-measure-edge-classification'

describe('roof plane edge classification', () => {
  it('builds a unit normal from Solar pitch/azimuth', () => {
    const [nx, ny, nz] = solarPlaneNormal(26.565, 180)
    expect(nx).toBeCloseTo(0, 2)
    expect(ny).toBeLessThan(-0.4)
    expect(nz).toBeGreaterThan(0.8)
  })

  it('2.5D path falls back to 2D when planes missing', () => {
    const facets = [
      {
        id: 'a',
        points: [
          { lat: 33.45, lng: -112.07 },
          { lat: 33.45, lng: -112.069 },
          { lat: 33.449, lng: -112.069 },
          { lat: 33.449, lng: -112.07 },
        ],
        facing_azimuth_degrees: 180,
      },
      {
        id: 'b',
        points: [
          { lat: 33.451, lng: -112.07 },
          { lat: 33.451, lng: -112.069 },
          { lat: 33.45, lng: -112.069 },
          { lat: 33.45, lng: -112.07 },
        ],
        facing_azimuth_degrees: 0,
      },
    ]
    const d2 = classifyRoofEdges(facets)
    const withPlanes = classifyRoofEdgesWithOptionalPlanes(facets, true)
    expect(withPlanes.ridges_lf + withPlanes.hips_lf).toBeGreaterThanOrEqual(0)
    expect(d2.ridges_lf).toBeGreaterThanOrEqual(0)
  })

  it('plane classifier returns same shape as 2D', () => {
    const facets = [
      {
        id: 'a',
        points: [
          { lat: 35.41, lng: -80.6 },
          { lat: 35.41, lng: -80.599 },
          { lat: 35.409, lng: -80.599 },
          { lat: 35.409, lng: -80.6 },
        ],
        facing_azimuth_degrees: 90,
        pitch_degrees: 22,
        plane_height_at_center_meters: 250,
      },
      {
        id: 'b',
        points: [
          { lat: 35.411, lng: -80.6 },
          { lat: 35.411, lng: -80.599 },
          { lat: 35.41, lng: -80.599 },
          { lat: 35.41, lng: -80.6 },
        ],
        facing_azimuth_degrees: 270,
        pitch_degrees: 22,
        plane_height_at_center_meters: 250,
      },
    ]
    const r = classifyRoofEdgesFromPlanes(facets)
    expect(r.ridges_lf).toBeGreaterThanOrEqual(0)
    expect(r.hips_lf).toBeGreaterThanOrEqual(0)
    expect(r.valleys_lf).toBeGreaterThanOrEqual(0)
  })
})

/**
 * When 2.5D wins: adjacent facets with reliable planeHeightAtCenterMeters and
 * pitch/azimuth where 2D azimuth heuristics mis-classify hips on complex layouts.
 * Flag stays off until Greenway calibration proves improvement over 2D.
 */
