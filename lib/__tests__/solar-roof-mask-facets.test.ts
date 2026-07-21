jest.mock('d3-contour', () => ({ contours: jest.fn() }))
jest.mock('geotiff', () => ({}))
jest.mock('geotiff-geokeys-to-proj4', () => ({}))
jest.mock('proj4', () => jest.fn())

import {
  filterSplitFacetsByPin,
  maskPlaneFacetSuggestions,
  mergeCoplanarSolarSegments,
  segmentFacetSuggestions,
  splitFacetsMeetMaskQualityThreshold,
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

  it('rejects non-plane facet sources', () => {
    expect(
      splitFacetsMeetMaskQualityThreshold([
        facet('whole-0', 32, -96, { facet_source: 'solar_mask_whole', estimated_sq_ft: 500 }),
      ])
    ).toBe(false)
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
