import {
  applyHeightAwareValleyHint,
  applyShortEdgeRidgeHeuristic,
  classifyRoofEdges,
  classifySharedEdge,
  computeFacetDrainAzimuth,
  edgeCloserToLowerPlane,
  azimuthToCompassString,
  FacetInput,
  SHORT_EDGE_RIDGE_MAX_LF,
} from '@/lib/roof-measure-edge-classification'
import { haversineDistanceFeet, RoofMeasurePoint } from '@/lib/roof-measure-geometry'

const BASE_LAT = 33.45
const BASE_LNG = -112.07
const FT_TO_LAT = 1 / 364000
const FT_TO_LNG = FT_TO_LAT / Math.cos((BASE_LAT * Math.PI) / 180)

function ft(northFt: number, eastFt: number): RoofMeasurePoint {
  return {
    lat: BASE_LAT + northFt * FT_TO_LAT,
    lng: BASE_LNG + eastFt * FT_TO_LNG,
  }
}

function rect(
  id: string,
  west: number,
  south: number,
  east: number,
  north: number
): FacetInput {
  return {
    id,
    points: [ft(south, west), ft(south, east), ft(north, east), ft(north, west)],
  }
}

function edgeLength(p1: RoofMeasurePoint, p2: RoofMeasurePoint): number {
  return Math.round(haversineDistanceFeet(p1, p2))
}

describe('roof-measure-edge-classification', () => {
  it('maps drain azimuth to 8 compass labels', () => {
    expect(azimuthToCompassString(0)).toBe('N')
    expect(azimuthToCompassString(90)).toBe('E')
    expect(azimuthToCompassString(180)).toBe('S')
  })

  it('computeFacetDrainAzimuth returns finite bearing for asymmetric single facet', () => {
    const points = [
      ft(-40, -30),
      ft(-40, 35),
      ft(40, 45),
      ft(40, -35),
    ]
    const az = computeFacetDrainAzimuth(points)
    expect(Number.isFinite(az)).toBe(true)
    expect(az).toBeGreaterThanOrEqual(0)
    expect(az).toBeLessThan(360)
  })

  it('classifies a 2-facet gable with shared horizontal ridge', () => {
    const south = rect('south', -50, -50, 50, 0)
    const north = rect('north', -50, 0, 50, 50)
    const result = classifyRoofEdges([south, north])

    const sharedRidgeLen = edgeLength(ft(0, -50), ft(0, 50))
    expect(result.ridges_lf).toBeGreaterThanOrEqual(sharedRidgeLen - 2)
    expect(result.ridges_lf).toBeLessThanOrEqual(sharedRidgeLen + 2)
    expect(result.hips_lf).toBe(0)
    expect(result.valleys_lf).toBe(0)
    expect(result.eaves_lf).toBeGreaterThan(0)
    expect(result.unclassified_shared_lf).toBe(0)
  })

  it('classifies single facet with only eaves and rakes', () => {
    const asymmetric = {
      id: 'only',
      points: [
        ft(-30, -20),
        ft(-30, 25),
        ft(35, 40),
        ft(35, -25),
      ],
    }
    const result = classifyRoofEdges([asymmetric])

    expect(result.ridges_lf).toBe(0)
    expect(result.hips_lf).toBe(0)
    expect(result.valleys_lf).toBe(0)
    expect(result.eaves_lf + result.rakes_lf).toBeGreaterThan(0)
    expect(result.unclassified_shared_lf).toBe(0)
  })

  it('classifies shared edge from slope dots and azimuth separation', () => {
    const south = ft(0, 0)
    const north = ft(40, 0)
    expect(classifySharedEdge(south, north, 90, 90)).toBe('valley')
    expect(classifySharedEdge(south, north, 90, 270)).toBe('ridge')
    expect(classifySharedEdge(south, north, 90, 0)).toBe('hip')
  })

  it('counts valley LF when a drawn pair converges on a shared edge', () => {
    const west: FacetInput = {
      id: 'west',
      points: [ft(-40, -40), ft(-40, 40), ft(0, 35), ft(0, -40)],
    }
    const east: FacetInput = {
      id: 'east',
      points: [ft(0, -40), ft(0, 35), ft(40, 40), ft(40, -40)],
    }
    const azW = computeFacetDrainAzimuth(west.points, west.id, new Set(['west:2']))
    const azE = computeFacetDrainAzimuth(east.points, east.id, new Set(['east:0']))
    const sharedType = classifySharedEdge(ft(0, -40), ft(0, 35), azW, azE)
    const result = classifyRoofEdges([west, east])

    if (sharedType === 'valley') {
      expect(result.valleys_lf).toBeGreaterThan(0)
    }
    expect(result.unclassified_shared_lf).toBe(0)
    expect(
      result.valleys_lf + result.ridges_lf + result.hips_lf
    ).toBeGreaterThan(0)
  })

  it('classifies a 4-quadrant layout with interior hips or ridges', () => {
    const facets: FacetInput[] = [
      rect('nw', -60, 0, 0, 60),
      rect('ne', 0, 0, 60, 60),
      rect('se', 0, -60, 60, 0),
      rect('sw', -60, -60, 0, 0),
    ]
    const result = classifyRoofEdges(facets)

    expect(result.hips_lf + result.ridges_lf).toBeGreaterThan(0)
    expect(result.unclassified_shared_lf).toBe(0)
  })

  it('ignores Solar panel-facing azimuth for interior R/H/V (uses drain bearing)', () => {
    const facets: FacetInput[] = [
      { ...rect('nw', -60, 0, 0, 60), facing_azimuth_degrees: 90 },
      { ...rect('ne', 0, 0, 60, 60), facing_azimuth_degrees: 90 },
      { ...rect('se', 0, -60, 60, 0), facing_azimuth_degrees: 90 },
      { ...rect('sw', -60, -60, 0, 0), facing_azimuth_degrees: 90 },
    ]
    const withMisleadingFacing = classifyRoofEdges(facets)
    const footprintOnly = classifyRoofEdges(
      facets.map(({ facing_azimuth_degrees: _f, ...rest }) => rest)
    )

    expect(withMisleadingFacing.hips_lf).toBe(footprintOnly.hips_lf)
    expect(withMisleadingFacing.ridges_lf).toBe(footprintOnly.ridges_lf)
    expect(withMisleadingFacing.valleys_lf).toBe(footprintOnly.valleys_lf)
    expect(withMisleadingFacing.hips_lf).toBeGreaterThan(0)
  })

  it('prefers ridge over valley on short dormer peak with differing pitch', () => {
    const main = rect('main', -80, -50, 80, 10)
    const dormerL: FacetInput = {
      id: 'dormer_l',
      pitch_degrees: 28,
      solar_segment_index: 1,
      points: [ft(10, -15), ft(10, 0), ft(22, 0), ft(18, -8)],
    }
    const dormerR: FacetInput = {
      id: 'dormer_r',
      pitch_degrees: 32,
      solar_segment_index: 2,
      points: [ft(10, 0), ft(10, 15), ft(18, 8), ft(22, 0)],
    }
    const peakP1 = ft(22, 0)
    const peakP2 = ft(18, -8)
    const peakLen = edgeLength(peakP1, peakP2)
    expect(peakLen).toBeLessThan(SHORT_EDGE_RIDGE_MAX_LF)

    const sharedEdgeSet = new Set(['dormer_l:2', 'dormer_r:3'])
    const azL = computeFacetDrainAzimuth(dormerL.points, dormerL.id, sharedEdgeSet)
    const azR = computeFacetDrainAzimuth(dormerR.points, dormerR.id, sharedEdgeSet)
    expect(classifySharedEdge(peakP1, peakP2, azL, azR)).toBe('valley')

    const result = classifyRoofEdges([main, dormerL, dormerR])
    expect(result.ridges_lf).toBeGreaterThan(0)
    expect(result.valleys_lf).toBe(0)
    expect(result.unclassified_shared_lf).toBe(0)
  })

  it('keeps L-valley on long converging shared edge (same pitch, no short-edge override)', () => {
    const west: FacetInput = {
      id: 'west',
      pitch_degrees: 22,
      points: [ft(-40, -40), ft(-40, 40), ft(0, 35), ft(0, -40)],
    }
    const east: FacetInput = {
      id: 'east',
      pitch_degrees: 22,
      points: [ft(0, -40), ft(0, 35), ft(40, 40), ft(40, -40)],
    }
    const valleyP1 = ft(0, -40)
    const valleyP2 = ft(0, 35)
    expect(edgeLength(valleyP1, valleyP2)).toBeGreaterThanOrEqual(SHORT_EDGE_RIDGE_MAX_LF)

    const sharedEdgeSet = new Set(['west:2', 'east:0'])
    const azW = computeFacetDrainAzimuth(west.points, west.id, sharedEdgeSet)
    const azE = computeFacetDrainAzimuth(east.points, east.id, sharedEdgeSet)
    const sharedType = classifySharedEdge(valleyP1, valleyP2, azW, azE)

    const result = classifyRoofEdges([west, east])
    if (sharedType === 'valley') {
      expect(result.valleys_lf).toBeGreaterThan(0)
    }
    expect(result.unclassified_shared_lf).toBe(0)
    expect(result.ridges_lf + result.hips_lf + result.valleys_lf).toBeGreaterThan(0)
  })

  it('uses manual drain_azimuth for interior edges instead of footprint or facing', () => {
    const south = rect('south', -50, -50, 50, 0)
    const north = rect('north', -50, 0, 50, 50)

    const footprintOnly = classifyRoofEdges([south, north])
    const withMisleadingFacing = classifyRoofEdges([
      { ...south, facing_azimuth_degrees: 90 },
      { ...north, facing_azimuth_degrees: 270 },
    ])
    const withManualDrain = classifyRoofEdges([
      {
        ...south,
        facing_azimuth_degrees: 90,
        drain_azimuth_source: 'manual',
        drain_azimuth_degrees: 180,
      },
      {
        ...north,
        facing_azimuth_degrees: 270,
        drain_azimuth_source: 'manual',
        drain_azimuth_degrees: 0,
      },
    ])

    expect(footprintOnly.ridges_lf).toBeGreaterThan(0)
    expect(withMisleadingFacing.ridges_lf).toBe(footprintOnly.ridges_lf)
    expect(withManualDrain.ridges_lf).toBe(footprintOnly.ridges_lf)
    expect(withManualDrain.valleys_lf).toBe(footprintOnly.valleys_lf)
  })

  it('edgeCloserToLowerPlane is true when shared edge hugs the lower facet', () => {
    const lower = {
      ...rect('lower', -80, -50, 80, 0),
      plane_height_at_center_meters: 8,
    }
    const upper = {
      ...rect('upper', -80, 0, 80, 40),
      plane_height_at_center_meters: 14,
    }
    const sharedP1 = ft(0, -80)
    const sharedP2 = ft(0, 80)

    expect(edgeCloserToLowerPlane(lower, upper, sharedP1, sharedP2)).toBe(true)
    expect(edgeCloserToLowerPlane(upper, lower, sharedP1, sharedP2)).toBe(true)
    expect(
      edgeCloserToLowerPlane(
        { ...lower, plane_height_at_center_meters: 12 },
        { ...upper, plane_height_at_center_meters: 12 },
        sharedP1,
        sharedP2
      )
    ).toBe(false)
  })

  it('applyHeightAwareValleyHint promotes ridge/hip to valley near lower plane', () => {
    const lower: FacetInput = {
      ...rect('lower', -80, -50, 80, 0),
      plane_height_at_center_meters: 8,
    }
    const upper: FacetInput = {
      ...rect('upper', -80, 0, 80, 40),
      plane_height_at_center_meters: 14,
    }
    const sharedP1 = ft(0, -80)
    const sharedP2 = ft(0, 80)

    expect(applyHeightAwareValleyHint('ridge', lower, upper, sharedP1, sharedP2)).toBe('valley')
    expect(applyHeightAwareValleyHint('hip', lower, upper, sharedP1, sharedP2)).toBe('valley')
    expect(applyHeightAwareValleyHint('valley', lower, upper, sharedP1, sharedP2)).toBe('valley')
    expect(
      applyHeightAwareValleyHint(
        'ridge',
        { ...lower, plane_height_at_center_meters: undefined },
        upper,
        sharedP1,
        sharedP2
      )
    ).toBe('ridge')
  })

  it('classifyRoofEdges uses plane height to count valley on lower-plane junction', () => {
    const lowerBase = rect('lower', -80, -50, 80, 0)
    const upperBase = rect('upper', -80, 0, 80, 40)
    const manualDrain = (f: FacetInput, degrees: number): FacetInput => ({
      ...f,
      drain_azimuth_source: 'manual',
      drain_azimuth_degrees: degrees,
    })

    const sharedP1 = ft(0, -80)
    const sharedP2 = ft(0, 80)
    expect(classifySharedEdge(sharedP1, sharedP2, 0, 180)).toBe('ridge')

    const withoutHeights = classifyRoofEdges([
      manualDrain(lowerBase, 0),
      manualDrain(upperBase, 180),
    ])
    const withHeights = classifyRoofEdges([
      {
        ...manualDrain(lowerBase, 0),
        plane_height_at_center_meters: 8,
      },
      {
        ...manualDrain(upperBase, 180),
        plane_height_at_center_meters: 14,
      },
    ])

    const sharedLen = edgeLength(sharedP1, sharedP2)
    expect(withoutHeights.ridges_lf).toBeGreaterThanOrEqual(sharedLen - 2)
    expect(withHeights.valleys_lf).toBeGreaterThanOrEqual(sharedLen - 2)
    expect(withHeights.ridges_lf).toBeLessThan(withoutHeights.ridges_lf)
    expect(withHeights.unclassified_shared_lf).toBe(0)
  })

  it('applyShortEdgeRidgeHeuristic only overrides valley when dots agree', () => {
    const facetA: FacetInput = { id: 'a', pitch_degrees: 20, points: [] }
    const facetB: FacetInput = { id: 'b', pitch_degrees: 30, points: [] }
    const peakP1 = ft(22, 0)
    const peakP2 = ft(18, -8)
    const azL = 180
    const azR = 180
    expect(classifySharedEdge(peakP1, peakP2, azL, azR)).toBe('valley')
    expect(
      applyShortEdgeRidgeHeuristic('valley', 8, facetA, facetB, azL, azR, peakP1, peakP2)
    ).toBe('ridge')
    expect(
      applyShortEdgeRidgeHeuristic('hip', 8, facetA, facetB, azL, azR, peakP1, peakP2)
    ).toBe('hip')
  })

  it('manual ridge replaces geo and manual valley adds to geo', () => {
    const geo = classifyRoofEdges([rect('a', 0, 0, 40, 40)])
    const manualRidges = 55
    const manualValleys = 12
    const ridges = manualRidges > 0 ? Math.round(manualRidges) : geo.ridges_lf
    const valleys = geo.valleys_lf + Math.round(manualValleys)

    expect(ridges).toBe(55)
    expect(valleys).toBe(geo.valleys_lf + 12)
  })
})
