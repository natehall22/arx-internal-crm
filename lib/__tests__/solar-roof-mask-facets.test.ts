jest.mock('geotiff', () => ({}))
jest.mock('geotiff-geokeys-to-proj4', () => ({}))
jest.mock('proj4', () => jest.fn())

import {
  brightAccessorySegmentIndices,
  facetsFromSplitMask,
  filterSplitFacetsByPin,
  largestNonOverlappingPlaneSubset,
  maskPlaneFacetSuggestions,
  mergeCoplanarSolarSegments,
  pruneSplitPlaneSlivers,
  segmentFacetSuggestions,
  selectUsableSplitFacets,
  splitFacetsMeetMaskQualityThreshold,
  splitFacetsMeetRelaxedMaskQualityThreshold,
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
