jest.mock('geotiff', () => ({}))
jest.mock('geotiff-geokeys-to-proj4', () => ({}))
jest.mock('proj4', () => jest.fn())

import {
  areaWeightedPitchMaxDeviationDegrees,
  brightAccessorySegmentIndices,
  facetsFromSplitMask,
  filterSplitFacetsByPin,
  largestNonOverlappingPlaneSubset,
  maskPlaneFacetSuggestions,
  mergeCoplanarSolarSegments,
  mergedPlanesFailPitchHomogeneity,
  pruneSplitPlaneSlivers,
  segmentFacetSuggestions,
  selectUsableSplitFacets,
  splitDropsGenuineFacet,
  splitFacetsMeetMaskQualityThreshold,
  splitFacetsMeetRelaxedMaskQualityThreshold,
  topologySimplifiedRings,
  topologyPartitionRings,
  type SolarMaskFacetPayload,
  type SolarMaskSegment,
} from '@/lib/solar-roof-mask-facets'

function facet(id: string, lat: number, lng: number, overrides?: Partial<SolarMaskFacetPayload>): SolarMaskFacetPayload {
  const d = 0.00002
  return {
    id,
    vertices: [],
    lat_lng_vertices: [
      { lat: lat + d, lng: lng - d },
      { lat: lat + d, lng: lng + d },
      { lat: lat - d, lng: lng + d },
      { lat: lat - d, lng: lng - d },
    ],
    confidence: 0.9,
    estimated_sq_ft: 100,
    solar_segment_index: null,
    suggested_pitch_degrees: null,
    suggested_azimuth_degrees: null,
    suggested_ground_area_sqft: null,
    suggested_sloped_area_sqft: null,
    plane_height_at_center_meters: null,
    facet_source: 'solar_mask_plane',
    ...overrides,
  }
}

describe('solar roof mask pin filtering', () => {
  it('keeps the roof under the requested pin and nearby same-house facets', () => {
    const requestedPin = { lat: 32, lng: -96 }
    const result = filterSplitFacetsByPin(
      [
        facet('target', 32, -96),
        facet('same-house', 32.00003, -96.00003),
        facet('neighbor', 32.001, -96.001),
      ],
      requestedPin
    )

    expect(result.map((item) => item.id).sort()).toEqual(['same-house', 'target'])
  })

  it('fails closed when Solar returns only a nearby-neighbor mask', () => {
    const requestedPin = { lat: 32, lng: -96 }
    const result = filterSplitFacetsByPin([facet('neighbor', 32.001, -96.001)], requestedPin)

    expect(result).toEqual([])
  })
})

describe('segment facet suggestions', () => {
  const segment: SolarMaskSegment = {
    segment_index: 2,
    pitch_degrees: 18.5,
    azimuth_degrees: 142,
    area_m2: 42,
    ground_area_m2: 40,
    plane_height_at_center_meters: 10.67585,
    center: { lat: 32, lng: -96 },
    bounding_box: null,
  }

  it('sets suggested_azimuth_degrees when segment has azimuth_degrees', () => {
    expect(segmentFacetSuggestions(segment)).toEqual({
      suggested_pitch_degrees: 18.5,
      suggested_azimuth_degrees: 142,
      suggested_ground_area_sqft: 40 * 10.7639,
      suggested_sloped_area_sqft: 42 * 10.7639,
      plane_height_at_center_meters: 10.67585,
    })
  })

  it('returns null suggestions when segment is missing', () => {
    expect(segmentFacetSuggestions(null)).toEqual({
      suggested_pitch_degrees: null,
      suggested_azimuth_degrees: null,
      suggested_ground_area_sqft: null,
      suggested_sloped_area_sqft: null,
      plane_height_at_center_meters: null,
    })
  })
})

describe('split mask quality threshold', () => {
  it('accepts solar_mask_plane facets with adequate footprint', () => {
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('plane-0', 32, -96, { facet_source: 'solar_mask_plane', estimated_sq_ft: 120 }),
      ])
    ).toBe(true)
  })

  it('rejects tiny split planes so whole-roof or bbox can win', () => {
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('plane-0', 32, -96, { facet_source: 'solar_mask_plane', estimated_sq_ft: 12 }),
      ])
    ).toBe(false)
  })

  it('rejects the entire split when any sibling plane is a tiny sliver', () => {
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('good-plane', 32, -96, { estimated_sq_ft: 500 }),
        facet('sliver', 32.00005, -96, { estimated_sq_ft: 12 }),
      ])
    ).toBe(false)
  })

  it('rejects overlapping plane interiors', () => {
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('plane-a', 32, -96, { estimated_sq_ft: 120 }),
        facet('plane-b', 32.00001, -96.00001, { estimated_sq_ft: 120 }),
      ])
    ).toBe(false)
  })

  it('allows adjacent planes that only share a boundary', () => {
    const d = 0.00002
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('left', 32, -96, {
          estimated_sq_ft: 120,
          lat_lng_vertices: [
            { lat: 32 + d, lng: -96 - d },
            { lat: 32 + d, lng: -96 },
            { lat: 32 - d, lng: -96 },
            { lat: 32 - d, lng: -96 - d },
          ],
        }),
        facet('right', 32, -96, {
          estimated_sq_ft: 120,
          lat_lng_vertices: [
            { lat: 32 + d, lng: -96 },
            { lat: 32 + d, lng: -96 + d },
            { lat: 32 - d, lng: -96 + d },
            { lat: 32 - d, lng: -96 },
          ],
        }),
      ])
    ).toBe(true)
  })

  it('rejects self-intersecting plane polygons', () => {
    const d = 0.00002
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('bow-tie', 32, -96, {
          estimated_sq_ft: 120,
          lat_lng_vertices: [
            { lat: 32 + d, lng: -96 - d },
            { lat: 32 - d, lng: -96 + d },
            { lat: 32 + d, lng: -96 + d },
            { lat: 32 - d, lng: -96 - d },
          ],
        }),
      ])
    ).toBe(false)
  })

  it('rejects split coverage far below or above the source mask area', () => {
    const plane = facet('plane-0', 32, -96, { estimated_sq_ft: 100 })
    expect(splitFacetsMeetMaskQualityThreshold([plane], 100)).toBe(true)
    expect(splitFacetsMeetMaskQualityThreshold([plane], 150)).toBe(false)
    expect(splitFacetsMeetMaskQualityThreshold([plane], 80)).toBe(false)
  })

  it('rejects non-plane facet sources', () => {
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('whole-0', 32, -96, { facet_source: 'solar_mask_whole', estimated_sq_ft: 500 }),
      ])
    ).toBe(false)
  })

  it('relaxed gate accepts multi-plane splits with wider coverage band', () => {
    const d = 0.00002
    const left = facet('left', 32, -96, {
      estimated_sq_ft: 400,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 - 2 * d },
        { lat: 32 + d, lng: -96 },
        { lat: 32 - d, lng: -96 },
        { lat: 32 - d, lng: -96 - 2 * d },
      ],
    })
    const right = facet('right', 32, -96, {
      estimated_sq_ft: 400,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 },
        { lat: 32 + d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 },
      ],
    })
    // Strict fails at 800/1000 = 0.80; relaxed (0.65+) accepts.
    expect(splitFacetsMeetMaskQualityThreshold([left, right], 1000)).toBe(false)
    expect(splitFacetsMeetRelaxedMaskQualityThreshold([left, right], 1000)).toBe(true)
    expect(selectUsableSplitFacets([left, right], 1000)?.mode).toBe('relaxed')

    const sliver = facet('sliver', 32.0006, -96, { estimated_sq_ft: 20 })
    const pruned = pruneSplitPlaneSlivers([left, right, sliver])
    expect(pruned).toHaveLength(2)
    expect(selectUsableSplitFacets([left, right, sliver], 800)?.mode).toBe('pruned')
  })

  it('prefers independent siblings when the largest plane overlaps every other plane', () => {
    const d = 0.00002
    const largeA = facet('a', 32, -96, {
      estimated_sq_ft: 600,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 - 2 * d },
        { lat: 32 + d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 - 2 * d },
      ],
    })
    // Fully inside largeA (vertices strictly interior) so greedy-by-area keeps only A.
    const b = facet('b', 32, -96, {
      estimated_sq_ft: 200,
      lat_lng_vertices: [
        { lat: 32 + 0.5 * d, lng: -96 - 1.5 * d },
        { lat: 32 + 0.5 * d, lng: -96 - 0.5 * d },
        { lat: 32 - 0.5 * d, lng: -96 - 0.5 * d },
        { lat: 32 - 0.5 * d, lng: -96 - 1.5 * d },
      ],
    })
    const c = facet('c', 32, -96, {
      estimated_sq_ft: 200,
      lat_lng_vertices: [
        { lat: 32 + 0.5 * d, lng: -96 + 0.5 * d },
        { lat: 32 + 0.5 * d, lng: -96 + 1.5 * d },
        { lat: 32 - 0.5 * d, lng: -96 + 1.5 * d },
        { lat: 32 - 0.5 * d, lng: -96 + 0.5 * d },
      ],
    })
    expect(largestNonOverlappingPlaneSubset([largeA, b, c]).map((f) => f.id).sort()).toEqual(['b', 'c'])
  })

  it('keeps a non-overlapping multi-plane subset when one pair overlaps', () => {
    const d = 0.00002
    const largeA = facet('a', 32, -96, {
      estimated_sq_ft: 400,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 - 2 * d },
        { lat: 32 + d, lng: -96 },
        { lat: 32 - d, lng: -96 },
        { lat: 32 - d, lng: -96 - 2 * d },
      ],
    })
    const largeB = facet('b', 32, -96, {
      estimated_sq_ft: 380,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 },
        { lat: 32 + d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 },
      ],
    })
    // Overlaps largeA substantially (same box as largeA but slightly shifted).
    const overlapping = facet('overlap', 32, -96.000005, {
      estimated_sq_ft: 200,
      lat_lng_vertices: [
        { lat: 32 + 0.5 * d, lng: -96 - 1.5 * d },
        { lat: 32 + 0.5 * d, lng: -96 + 0.5 * d },
        { lat: 32 - 0.5 * d, lng: -96 + 0.5 * d },
        { lat: 32 - 0.5 * d, lng: -96 - 1.5 * d },
      ],
    })
    expect(splitFacetsMeetMaskQualityThreshold([largeA, largeB, overlapping], 980)).toBe(false)
    const subset = largestNonOverlappingPlaneSubset([largeA, largeB, overlapping])
    expect(subset.map((f) => f.id).sort()).toEqual(['a', 'b'])
    expect(selectUsableSplitFacets([largeA, largeB, overlapping], 980)?.mode).toBe('nonoverlap')
    expect(selectUsableSplitFacets([largeA, largeB, overlapping], 980)?.facets).toHaveLength(2)
  })

  it('keeps the multi-plane split when a dropped end is within the mask fraction (Greenway-style hip end)', () => {
    const d = 0.00002
    const left = facet('left', 32, -96, {
      estimated_sq_ft: 1000,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 - 2 * d },
        { lat: 32 + d, lng: -96 },
        { lat: 32 - d, lng: -96 },
        { lat: 32 - d, lng: -96 - 2 * d },
      ],
    })
    const right = facet('right', 32, -96, {
      estimated_sq_ft: 1000,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 },
        { lat: 32 + d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 },
      ],
    })
    const genuineEnd = facet('end', 32, -95.9999, { estimated_sq_ft: 60 })
    const noise = facet('noise', 32.0006, -96, { estimated_sq_ft: 20 })

    expect(pruneSplitPlaneSlivers([left, right, genuineEnd, noise]).map((f) => f.id).sort()).toEqual([
      'left',
      'right',
    ])
    // 60 sqft end is ~2.9% of the 2080 sqft mask — below the degrade fraction, so the split
    // keeps its multi-plane result (this is Greenway's small hip-end case).
    expect(selectUsableSplitFacets([left, right, genuineEnd, noise], 2080)?.mode).toBe('pruned')

    // Direct guard: an uncovered dropped end above the mask fraction (400/2400 ≈ 17%) flags the
    // under-count; below it (60/2400 ≈ 2.5%) it is tolerated.
    const bigEnd = facet('bigend', 32, -95.9999, { estimated_sq_ft: 400 })
    expect(splitDropsGenuineFacet([left, right, bigEnd], [left, right], 2400)).toBe(true)
    expect(splitDropsGenuineFacet([left, right, genuineEnd], [left, right], 2400)).toBe(false)
  })

  it('returns null for fully overlapping planes even when coverage is good', () => {
    // Same footprint — definite interior overlap; nonoverlap search finds no pair ≥2.
    const a = facet('a', 32, -96, { estimated_sq_ft: 500 })
    const b = facet('b', 32.00001, -96.00001, { estimated_sq_ft: 500 })
    expect(splitFacetsMeetRelaxedMaskQualityThreshold([a, b], 1000)).toBe(false)
    expect(largestNonOverlappingPlaneSubset([a, b])).toEqual([])
    expect(selectUsableSplitFacets([a, b], 1000)).toBeNull()
  })

  it('relaxed gate accepts ~68% mask coverage common after contour loss', () => {
    const d = 0.00002
    const left = facet('left', 32, -96, {
      estimated_sq_ft: 340,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 - 2 * d },
        { lat: 32 + d, lng: -96 },
        { lat: 32 - d, lng: -96 },
        { lat: 32 - d, lng: -96 - 2 * d },
      ],
    })
    const right = facet('right', 32, -96, {
      estimated_sq_ft: 340,
      lat_lng_vertices: [
        { lat: 32 + d, lng: -96 },
        { lat: 32 + d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 + 2 * d },
        { lat: 32 - d, lng: -96 },
      ],
    })
    expect(splitFacetsMeetRelaxedMaskQualityThreshold([left, right], 1000)).toBe(true)
    expect(selectUsableSplitFacets([left, right], 1000)?.mode).toBe('relaxed')
  })

  it('accepts high-vertex non-overlapping planes as a usable split', () => {
    const noisy = facet('noisy', 32, -96, {
      estimated_sq_ft: 500,
      lat_lng_vertices: Array.from({ length: 73 }, (_, index) => {
        const angle = (index / 73) * Math.PI * 2
        return { lat: 32 + Math.sin(angle) * 0.00003, lng: -96 + Math.cos(angle) * 0.00003 }
      }),
    })
    const sibling = facet('sibling', 32, -95.9999, { estimated_sq_ft: 500 })

    const usable = selectUsableSplitFacets([noisy, sibling], 1000)
    expect(usable).not.toBeNull()
    expect(['strict', 'relaxed']).toContain(usable?.mode)
    expect(usable?.facets).toHaveLength(2)
  })

  it('prefers an uncapped usable split over a capped split that fails quality', () => {
    // Separated circles: uncapped passes. Soft-cap recomputes footprint from the tiny
    // geometry and can miss the coverage band — still ship the uncapped usable split
    // rather than falling through to whole-mask / bbox.
    const left = facet('left', 32, -96.0001, {
      estimated_sq_ft: 500,
      lat_lng_vertices: Array.from({ length: 90 }, (_, index) => {
        const angle = (index / 90) * Math.PI * 2
        return { lat: 32 + Math.sin(angle) * 0.000025, lng: -96.0001 + Math.cos(angle) * 0.000025 }
      }),
    })
    const right = facet('right', 32, -95.9999, {
      estimated_sq_ft: 500,
      lat_lng_vertices: Array.from({ length: 90 }, (_, index) => {
        const angle = (index / 90) * Math.PI * 2
        return { lat: 32 + Math.sin(angle) * 0.000025, lng: -95.9999 + Math.cos(angle) * 0.000025 }
      }),
    })

    expect(splitFacetsMeetRelaxedMaskQualityThreshold([left, right], 1000)).toBe(true)
    const usable = selectUsableSplitFacets([left, right], 1000)
    expect(usable).not.toBeNull()
    expect(usable?.facets).toHaveLength(2)
    // Uncapped may remain above the soft UI budget when polish would invalidate quality.
    expect(Math.max(...(usable?.facets.map((f) => f.lat_lng_vertices.length) ?? [0]))).toBeGreaterThan(72)
  })

  it('fails closed when vertex-capped planes still fully overlap', () => {
    const d = 0.00003
    const noisyA = facet('a', 32, -96, {
      estimated_sq_ft: 500,
      lat_lng_vertices: Array.from({ length: 80 }, (_, index) => {
        const angle = (index / 80) * Math.PI * 2
        return { lat: 32 + Math.sin(angle) * d, lng: -96 + Math.cos(angle) * d }
      }),
    })
    const noisyB = facet('b', 32.00001, -96.00001, {
      estimated_sq_ft: 500,
      lat_lng_vertices: Array.from({ length: 80 }, (_, index) => {
        const angle = (index / 80) * Math.PI * 2
        return { lat: 32.00001 + Math.sin(angle) * d, lng: -96.00001 + Math.cos(angle) * d }
      }),
    })

    expect(selectUsableSplitFacets([noisyA, noisyB], 1000)).toBeNull()
  })
})

describe('exclusive split plane lock', () => {
  const width = 48
  const height = 36
  const pixelToLngLat = (col: number, row: number) => ({
    lat: 35 + row * 0.00001,
    lng: -80 + col * 0.00001,
  })

  function buildAdjacentSplitMask() {
    const bin = new Uint8Array(width * height)
    const labels = new Int32Array(width * height).fill(-1)
    for (let row = 6; row < 30; row++) {
      for (let col = 6; col < 23; col++) {
        const i = row * width + col
        bin[i] = 1
        labels[i] = 0
      }
      for (let col = 23; col < 42; col++) {
        const i = row * width + col
        bin[i] = 1
        labels[i] = 1
      }
    }
    return { bin, labels }
  }

  const segsPx = [
    {
      segment_index: 0,
      col: 14,
      row: 18,
      minC: 0,
      maxC: width - 1,
      minR: 0,
      maxR: height - 1,
      hasSpatialBounds: false,
    },
    {
      segment_index: 1,
      col: 32,
      row: 18,
      minC: 0,
      maxC: width - 1,
      minR: 0,
      maxR: height - 1,
      hasSpatialBounds: false,
    },
  ]

  const segments: SolarMaskSegment[] = [
    {
      segment_index: 0,
      pitch_degrees: 26,
      azimuth_degrees: 180,
      area_m2: 40,
      ground_area_m2: 36,
      plane_height_at_center_meters: 190,
      center: pixelToLngLat(14, 18),
      bounding_box: null,
    },
    {
      segment_index: 1,
      pitch_degrees: 26,
      azimuth_degrees: 0,
      area_m2: 40,
      ground_area_m2: 36,
      plane_height_at_center_meters: 190,
      center: pixelToLngLat(32, 18),
      bounding_box: null,
    },
  ]

  it('adjacent planes share boundary only after pipeline', () => {
    const { bin, labels } = buildAdjacentSplitMask()
    const facets = facetsFromSplitMask({
      bin,
      labels,
      width,
      height,
      segsPx,
      segments,
      pixelToLngLat,
    })
    expect(facets.length).toBe(2)
    expect(splitFacetsMeetMaskQualityThreshold(facets)).toBe(true)
  })

  it('exclusivity lock prevents simplify/hull bleed into a neighbor label', () => {
    const { bin, labels } = buildAdjacentSplitMask()
    for (let row = 14; row < 22; row++) {
      const i = row * width + 22
      bin[i] = 1
      labels[i] = 0
    }
    const facets = facetsFromSplitMask({
      bin,
      labels,
      width,
      height,
      segsPx,
      segments,
      pixelToLngLat,
    })
    expect(facets.length).toBe(2)
    expect(splitFacetsMeetMaskQualityThreshold(facets)).toBe(true)
    expect(facets.every((facet) => facet.lat_lng_vertices.length === 4)).toBe(true)
    const shared = facets[0].lat_lng_vertices.filter((point) =>
      facets[1].lat_lng_vertices.some(
        (other) => other.lat === point.lat && other.lng === point.lng
      )
    )
    expect(shared).toHaveLength(2)
  })

  it('simplifies a concave two-plane outline around one shared ridge without overlap', () => {
    const { bin, labels } = buildAdjacentSplitMask()
    // A deep exterior notch makes a convex hull unsafe; the shared whole outline must
    // remain concave while still collapsing raster stair-steps to field-editable edges.
    for (let row = 14; row < 22; row++) {
      for (let col = 6; col < 13; col++) {
        const i = row * width + col
        bin[i] = 0
        labels[i] = -1
      }
    }
    const facets = facetsFromSplitMask({
      bin,
      labels,
      width,
      height,
      segsPx,
      segments,
      pixelToLngLat,
    })
    expect(facets).toHaveLength(2)
    expect(facets.every((facet) => facet.lat_lng_vertices.length <= 12)).toBe(true)
    expect(splitFacetsMeetMaskQualityThreshold(facets)).toBe(true)
  })

  it('jointly simplifies three adjacent planes without creating overlap', () => {
    const bin = new Uint8Array(width * height)
    const labels = new Int32Array(width * height).fill(-1)
    for (let row = 6; row < 30; row++) {
      for (let col = 6; col < 42; col++) {
        const i = row * width + col
        bin[i] = 1
        labels[i] = col < 18 ? 0 : col < 30 ? 1 : 2
      }
    }
    const threeSegsPx = [
      { ...segsPx[0], col: 12 },
      { ...segsPx[0], segment_index: 1, col: 24 },
      { ...segsPx[0], segment_index: 2, col: 36 },
    ]
    const threeSegments: SolarMaskSegment[] = [0, 1, 2].map((segment_index) => ({
      ...segments[0],
      segment_index,
      center: pixelToLngLat(12 + segment_index * 12, 18),
    }))
    const facets = facetsFromSplitMask({
      bin,
      labels,
      width,
      height,
      segsPx: threeSegsPx,
      segments: threeSegments,
      pixelToLngLat,
    })
    expect(facets).toHaveLength(3)
    expect(facets.every((facet) => facet.lat_lng_vertices.length <= 6)).toBe(true)
    expect(splitFacetsMeetMaskQualityThreshold(facets)).toBe(true)
  })

  it('preserves a finite three-plane junction while simplifying its shared arcs', () => {
    const bin = new Uint8Array(width * height)
    const labels = new Int32Array(width * height).fill(-1)
    for (let row = 6; row < 30; row++) {
      for (let col = 6; col < 42; col++) {
        const i = row * width + col
        bin[i] = 1
        labels[i] = col < 24 ? 0 : row < 18 ? 1 : 2
      }
    }
    const ordered = [
      { ...segsPx[0], col: 15 },
      { ...segsPx[0], segment_index: 1, col: 33, row: 12 },
      { ...segsPx[0], segment_index: 2, col: 33, row: 24 },
    ]
    const rings = topologySimplifiedRings({ bin, labels, width, height, ordered })

    expect(rings).not.toBeNull()
    expect(Array.from(rings?.values() ?? []).every((ring) => ring.length - 1 <= 8)).toBe(true)
    const junctionEnds = Array.from(rings?.values() ?? []).map((ring) =>
      ring
        .slice(0, -1)
        .reduce((best, point) =>
          Math.hypot(point[0] - 24, point[1] - 18) < Math.hypot(best[0] - 24, best[1] - 18)
            ? point
            : best
        )
    )
    expect(junctionEnds.every(([x, y]) => Math.hypot(x - 24, y - 18) <= 1)).toBe(true)
    expect(
      junctionEnds.every((point, index) =>
        junctionEnds.slice(index + 1).every((other) =>
          Math.hypot(point[0] - other[0], point[1] - other[1]) <= Math.SQRT2
        )
      )
    ).toBe(true)
  })

  it('partition solver derives a finite three-plane junction with shared vertices, no overlap', () => {
    const bin = new Uint8Array(width * height)
    const labels = new Int32Array(width * height).fill(-1)
    for (let row = 6; row < 30; row++) {
      for (let col = 6; col < 42; col++) {
        const i = row * width + col
        bin[i] = 1
        labels[i] = col < 24 ? 0 : row < 18 ? 1 : 2
      }
    }
    const ordered = [
      { ...segsPx[0], col: 15 },
      { ...segsPx[0], segment_index: 1, col: 33, row: 12 },
      { ...segsPx[0], segment_index: 2, col: 33, row: 24 },
    ]
    const rings = topologyPartitionRings({ bin, labels, width, height, ordered })

    // A non-null return already proves every acceptance gate passed: simple polygons,
    // <=72 vertices, >=0.9 per-plane fidelity, coverage band, and zero raster overlap.
    expect(rings).not.toBeNull()
    expect(rings?.size).toBe(3)
    expect(Array.from(rings?.values() ?? []).every((ring) => ring.length - 1 <= 8)).toBe(true)

    // All three planes meet at the shared junction near (24, 18); because each arc is
    // simplified once and reused, the owners' junction vertices coincide.
    const junctionEnds = Array.from(rings?.values() ?? []).map((ring) =>
      ring
        .slice(0, -1)
        .reduce((best, point) =>
          Math.hypot(point[0] - 24, point[1] - 18) < Math.hypot(best[0] - 24, best[1] - 18)
            ? point
            : best
        )
    )
    expect(junctionEnds.every(([x, y]) => Math.hypot(x - 24, y - 18) <= 1)).toBe(true)
    expect(
      junctionEnds.every((point, index) =>
        junctionEnds
          .slice(index + 1)
          .every((other) => Math.hypot(point[0] - other[0], point[1] - other[1]) <= Math.SQRT2)
      )
    ).toBe(true)
  })
})

describe('coplanar Solar segment merging', () => {
  const makeSegment = (
    index: number,
    azimuth: number,
    height: number,
    lngOffset: number
  ): SolarMaskSegment => ({
    segment_index: index,
    pitch_degrees: 26,
    azimuth_degrees: azimuth,
    area_m2: 20,
    ground_area_m2: 18,
    plane_height_at_center_meters: height,
    center: { lat: 35, lng: -80 + lngOffset },
    bounding_box: null,
  })

  it('combines near-identical fragments of one physical plane', () => {
    const merged = mergeCoplanarSolarSegments(
      [makeSegment(0, 154, 190, 0), makeSegment(1, 155, 190, 0)],
      { lat: 35, lng: -80 }
    )

    expect(merged).toHaveLength(1)
    expect(merged[0].ground_area_m2).toBe(36)
    expect(merged[0].merged_segment_count).toBe(2)
    expect(maskPlaneFacetSuggestions(merged[0])).toMatchObject({
      suggested_ground_area_sqft: null,
      suggested_sloped_area_sqft: null,
      suggested_pitch_degrees: 26,
    })
  })

  it('preserves the combined Solar footprint when fragments merge', () => {
    const a = makeSegment(0, 154, 190, 0)
    const b = makeSegment(1, 155, 190, 0)
    a.bounding_box = {
      sw: { lat: 34.9999, lng: -80.0002 },
      ne: { lat: 35.0001, lng: -80.0 },
    }
    b.bounding_box = {
      sw: { lat: 35.0, lng: -80.0001 },
      ne: { lat: 35.0002, lng: -79.9998 },
    }

    const merged = mergeCoplanarSolarSegments([a, b], { lat: 35, lng: -80 })

    expect(merged[0].bounding_box).toEqual({
      sw: { lat: 34.9999, lng: -80.0002 },
      ne: { lat: 35.0002, lng: -79.9998 },
    })
  })

  it('keeps a parallel elevated dormer separate', () => {
    const merged = mergeCoplanarSolarSegments(
      [makeSegment(0, 154, 190, 0), makeSegment(1, 155, 192, 0)],
      { lat: 35, lng: -80 }
    )

    expect(merged).toHaveLength(2)
    expect(maskPlaneFacetSuggestions(merged[0]).suggested_sloped_area_sqft).toBe(20 * 10.7639)
  })

  it('keeps opposing roof faces separate', () => {
    const merged = mergeCoplanarSolarSegments(
      [makeSegment(0, 154, 190, 0), makeSegment(1, 334, 190, 0)],
      { lat: 35, lng: -80 }
    )

    expect(merged).toHaveLength(2)
  })

  it('does not merge pitch-distinct faces that only share elevation at centers', () => {
    // Greenway-class dormer: ~6.6° shallower, similar height/azimuth, ~6 m apart so the
    // center-height check still passes — separation must come from the pitch-soft nesting
    // rule (smaller center not inside the larger Solar bbox).
    const main: SolarMaskSegment = {
      segment_index: 0,
      pitch_degrees: 21.3,
      azimuth_degrees: 305,
      area_m2: 40,
      ground_area_m2: 40,
      plane_height_at_center_meters: 234.6,
      center: { lat: 35.0, lng: -80.0 },
      bounding_box: {
        sw: { lat: 34.9997, lng: -80.0003 },
        ne: { lat: 35.0001, lng: -79.9998 },
      },
    }
    const dormer: SolarMaskSegment = {
      segment_index: 5,
      pitch_degrees: 14.7,
      azimuth_degrees: 323,
      area_m2: 15,
      ground_area_m2: 15,
      // Height chosen so main plane predicts dormer center within 1 m (matches live Greenway).
      plane_height_at_center_meters: 234.9,
      center: { lat: 35.00005, lng: -79.9997 },
      bounding_box: {
        sw: { lat: 35.0000, lng: -79.99975 },
        ne: { lat: 35.0001, lng: -79.99965 },
      },
    }

    const merged = mergeCoplanarSolarSegments([main, dormer], { lat: 35.0, lng: -80.0 })
    expect(merged).toHaveLength(2)
  })

  it('still merges same-pitch contiguous shards of one physical plane', () => {
    // Pitch noise well under the soft threshold; identical plane height so center-height
    // coplanarity holds (Epworth/Kim-Green shard class).
    const a: SolarMaskSegment = {
      segment_index: 0,
      pitch_degrees: 26.1,
      azimuth_degrees: 154,
      area_m2: 40,
      ground_area_m2: 40,
      plane_height_at_center_meters: 192,
      center: { lat: 35.0, lng: -80.0 },
      bounding_box: {
        sw: { lat: 34.9998, lng: -80.0003 },
        ne: { lat: 35.0002, lng: -79.9997 },
      },
    }
    const b: SolarMaskSegment = {
      segment_index: 1,
      pitch_degrees: 26.5,
      azimuth_degrees: 155,
      area_m2: 14,
      ground_area_m2: 14,
      plane_height_at_center_meters: 192,
      center: { lat: 35.0, lng: -80.00005 },
      bounding_box: {
        sw: { lat: 34.99995, lng: -80.00015 },
        ne: { lat: 35.00015, lng: -79.99995 },
      },
    }

    const merged = mergeCoplanarSolarSegments([a, b], { lat: 35, lng: -80 })
    expect(merged).toHaveLength(1)
    expect(merged[0].merged_segment_count).toBe(2)
    expect(merged[0].constituent_pitches).toEqual([26.1, 26.5])
  })
})

describe('pitch homogeneity safety gate', () => {
  it('rejects a bimodal-pitch merged plane (area-weighted deviation)', () => {
    const bimodal: SolarMaskSegment = {
      segment_index: 0,
      pitch_degrees: 20,
      azimuth_degrees: 180,
      area_m2: 50,
      ground_area_m2: 50,
      plane_height_at_center_meters: 200,
      center: { lat: 35, lng: -80 },
      bounding_box: null,
      merged_segment_count: 2,
      constituent_pitches: [14, 28],
      constituent_ground_areas: [25, 25],
    }
    expect(areaWeightedPitchMaxDeviationDegrees([14, 28], [25, 25])).toBe(7)
    expect(mergedPlanesFailPitchHomogeneity([bimodal])).toBe(true)
  })

  it('rejects a transitive pitch chain that hides under the mean', () => {
    const chained: SolarMaskSegment = {
      segment_index: 0,
      pitch_degrees: 20,
      azimuth_degrees: 180,
      area_m2: 60,
      ground_area_m2: 60,
      plane_height_at_center_meters: 200,
      center: { lat: 35, lng: -80 },
      bounding_box: null,
      merged_segment_count: 3,
      constituent_pitches: [14, 20, 26],
      constituent_ground_areas: [20, 20, 20],
    }
    expect(areaWeightedPitchMaxDeviationDegrees([14, 20, 26], [20, 20, 20])).toBe(6)
    expect(mergedPlanesFailPitchHomogeneity([chained])).toBe(true)
  })

  it('allows a same-face shard group under the deviation cap', () => {
    const ok: SolarMaskSegment = {
      segment_index: 0,
      pitch_degrees: 26,
      azimuth_degrees: 180,
      area_m2: 50,
      ground_area_m2: 50,
      plane_height_at_center_meters: 200,
      center: { lat: 35, lng: -80 },
      bounding_box: null,
      merged_segment_count: 3,
      constituent_pitches: [26.0, 26.4, 27.0],
      constituent_ground_areas: [40, 14, 10],
    }
    expect(mergedPlanesFailPitchHomogeneity([ok])).toBe(false)
  })
})

describe('bright accessory plane filtering', () => {
  const segment = (index: number, pitch: number, height: number): SolarMaskSegment => ({
    segment_index: index,
    pitch_degrees: pitch,
    azimuth_degrees: index % 2 ? 340 : 160,
    area_m2: 20,
    ground_area_m2: 19,
    plane_height_at_center_meters: height,
    center: { lat: 35, lng: -80 },
    bounding_box: null,
  })

  it('identifies a white low-slope accessory plane among darker shingles', () => {
    const segments = [
      segment(0, 11.7, 215.41),
      segment(1, 9.9, 215.52),
      segment(2, 6.6, 214.9),
      segment(3, 9.9, 215.57),
      segment(4, 10.3, 215.44),
      segment(5, 11.2, 215.39),
    ]
    const samples = new Map([
      [0, { r: 190, g: 179, b: 185 }],
      [1, { r: 173, g: 165, b: 173 }],
      [2, { r: 249, g: 249, b: 250 }],
      [3, { r: 163, g: 156, b: 166 }],
      [4, { r: 171, g: 163, b: 173 }],
      [5, { r: 189, g: 181, b: 186 }],
    ])

    expect(Array.from(brightAccessorySegmentIndices(segments, samples))).toEqual([2])
  })

  it('does not remove ordinary shaded planes from a uniform shingle roof', () => {
    const segments = [
      segment(0, 26, 191.81),
      segment(1, 26.4, 192.09),
      segment(2, 26.8, 191.61),
      segment(3, 19.8, 191.51),
      segment(4, 27.5, 191.46),
      segment(5, 28.1, 191.63),
    ]
    const samples = new Map(
      segments.map((item, index) => [item.segment_index, { r: 127 + index * 6, g: 129 + index * 5, b: 162 + index * 3 }])
    )

    expect(brightAccessorySegmentIndices(segments, samples).size).toBe(0)
  })
})
