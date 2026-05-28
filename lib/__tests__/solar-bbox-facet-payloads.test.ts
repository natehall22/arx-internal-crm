import {
  boundingBoxToLatLngQuad,
  buildSolarBboxFacetPayloads,
} from '@/lib/solar-bbox-facet-payloads'

describe('solar bbox facet payloads', () => {
  it('builds a four-corner quad from segment boundingBox', () => {
    const quad = boundingBoxToLatLngQuad({
      sw: { lat: 35.40, lng: -80.60 },
      ne: { lat: 35.41, lng: -80.59 },
    })
    expect(quad).toHaveLength(4)
    expect(quad![0]).toEqual({ lat: 35.41, lng: -80.6 })
    expect(quad![2]).toEqual({ lat: 35.4, lng: -80.59 })
  })

  it('returns drawable facets (never empty when segments have boxes)', () => {
    const facets = buildSolarBboxFacetPayloads([
      {
        segment_index: 0,
        pitch_degrees: 18,
        azimuth_degrees: 90,
        area_m2: 120,
        ground_area_m2: 110,
        center: { lat: 35.405, lng: -80.595 },
        bounding_box: {
          sw: { lat: 35.404, lng: -80.596 },
          ne: { lat: 35.406, lng: -80.594 },
        },
      },
      {
        segment_index: 1,
        pitch_degrees: 18,
        azimuth_degrees: 270,
        area_m2: 80,
        ground_area_m2: 75,
        center: { lat: 35.4055, lng: -80.595 },
        bounding_box: {
          sw: { lat: 35.4045, lng: -80.596 },
          ne: { lat: 35.4065, lng: -80.594 },
        },
      },
    ])
    expect(facets.length).toBe(2)
    expect(facets[0].facet_source).toBe('solar_bbox')
    expect(facets[0].lat_lng_vertices.length).toBe(4)
    expect(facets[0].estimated_sq_ft).toBeGreaterThan(0)
  })
})
