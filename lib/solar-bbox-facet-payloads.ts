export type SolarBboxSegment = {
  segment_index: number
  pitch_degrees: number | null
  azimuth_degrees: number | null
  area_m2: number | null
  ground_area_m2: number | null
  plane_height_at_center_meters: number | null
  center: { lat: number; lng: number } | null
  bounding_box: {
    sw: { lat: number; lng: number }
    ne: { lat: number; lng: number }
  } | null
}

export type SolarBboxFacetPayload = {
  id: string
  vertices: []
  lat_lng_vertices: { lat: number; lng: number }[]
  confidence: number
  estimated_sq_ft: number | null
  solar_segment_index: number | null
  suggested_pitch_degrees: number | null
  suggested_azimuth_degrees: number | null
  suggested_ground_area_sqft: number | null
  suggested_sloped_area_sqft: number | null
  plane_height_at_center_meters: number | null
  facet_source: 'solar_bbox'
}

export type MapBoundsLatLng = {
  north: number
  south: number
  east: number
  west: number
}

function centroidInExpandedBounds(
  lat: number,
  lng: number,
  bounds: MapBoundsLatLng,
  padFraction: number
): boolean {
  const latSpan = bounds.north - bounds.south
  const lngSpan = bounds.east - bounds.west
  const latPad = latSpan * padFraction
  const lngPad = lngSpan * padFraction
  return (
    lat <= bounds.north + latPad &&
    lat >= bounds.south - latPad &&
    lng <= bounds.east + lngPad &&
    lng >= bounds.west - lngPad
  )
}

/** NW → NE → SE → SW quad from Google Solar segment boundingBox (see roofSegmentStats). */
export function boundingBoxToLatLngQuad(box: {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}): { lat: number; lng: number }[] | null {
  const { ne, sw } = box
  if (!(ne.lat > sw.lat) || !(ne.lng > sw.lng)) return null
  const nw = { lat: ne.lat, lng: sw.lng }
  const se = { lat: sw.lat, lng: ne.lng }
  return [nw, ne, se, sw]
}

/** One lat/lng quad per Google Solar segment bounding box — rough footprint when mask split fails. */
export function buildSolarBboxFacetPayloads(
  segments: SolarBboxSegment[],
  validBounds: MapBoundsLatLng | null = null
): SolarBboxFacetPayload[] {
  const out: SolarBboxFacetPayload[] = []
  for (const seg of segments) {
    const box = seg.bounding_box
    if (!box) continue
    const latLngVertices = boundingBoxToLatLngQuad(box)
    if (!latLngVertices) continue

    const cLat = latLngVertices.reduce((s, p) => s + p.lat, 0) / 4
    const cLng = latLngVertices.reduce((s, p) => s + p.lng, 0) / 4
    if (validBounds && !centroidInExpandedBounds(cLat, cLng, validBounds, 0.18)) continue

    const estSqFt =
      typeof seg.ground_area_m2 === 'number'
        ? Math.round(seg.ground_area_m2 * 10.7639)
        : typeof seg.area_m2 === 'number'
          ? Math.round(seg.area_m2 * 10.7639)
          : null

    out.push({
      id: `solar_plane_${seg.segment_index}`,
      vertices: [],
      lat_lng_vertices: latLngVertices,
      confidence: 0.35,
      estimated_sq_ft: estSqFt,
      solar_segment_index: seg.segment_index,
      suggested_pitch_degrees: seg.pitch_degrees,
      suggested_azimuth_degrees: seg.azimuth_degrees,
      suggested_ground_area_sqft:
        typeof seg.ground_area_m2 === 'number' ? seg.ground_area_m2 * 10.7639 : null,
      suggested_sloped_area_sqft:
        typeof seg.area_m2 === 'number' ? seg.area_m2 * 10.7639 : null,
      plane_height_at_center_meters: seg.plane_height_at_center_meters,
      facet_source: 'solar_bbox',
    })
  }
  return out
}

export const SOLAR_BBOX_ONLY_USER_NOTES =
  'Satellite data for this address has rough outlines only — they may not match the roof exactly. Drag the corners to adjust, or use Draw a section to trace it yourself.'
