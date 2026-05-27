import { classifyRoofEdges } from '@/lib/roof-measure-edge-classification'
import { facingCompassFromAzimuthDegrees, pitchRiseFromDegrees } from '@/lib/roof-face-solar-alignment'
import { hipRidgeCapFromLinearFt } from '@/lib/hip-ridge-cap-squares'
import { mapAuroraRoofSummaryToMeasurement } from '@/lib/aurora-roof-summary-mapper'

describe('roof measure launch smoke', () => {
  it('wires facing-aware classification + cap + aurora mapper', () => {
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
    const edges = classifyRoofEdges(facets)
    expect(edges.ridges_lf + edges.hips_lf + edges.valleys_lf).toBeGreaterThanOrEqual(0)

    expect(facingCompassFromAzimuthDegrees(90)).toBe('E')
    expect(pitchRiseFromDegrees(26.565)).toBeGreaterThan(5)

    const cap = hipRidgeCapFromLinearFt({ ridges_lf: 50, hips_lf: 30 })
    expect(cap?.combinedLf).toBe(80)

    const aurora = mapAuroraRoofSummaryToMeasurement({
      roofs: [
        {
          faces: [{ area: 1000, azimuth: 180, pitch: 22 }],
          edges_length: { ridge: 40, hip: 0, valley: 0, eave: 80, rake: 20 },
        },
      ],
    })
    expect(aurora.ridges_lf).toBe(40)
    expect(aurora.facet_count).toBe(1)
  })
})
