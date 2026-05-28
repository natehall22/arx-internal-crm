export interface RoofMeasurePoint {
  lat: number
  lng: number
}

const FEET_PER_METER = 3.280839895
const SQFT_PER_SQUARE_METER = 10.763910417
const EARTH_RADIUS_METERS = 6371008.8

export function pitchMultiplierFromRise(rise: number): number {
  if (!Number.isFinite(rise) || rise < 0) return 1
  return Math.sqrt(1 + Math.pow(rise / 12, 2))
}

export function pitchDegreesFromRise(rise: number): number {
  if (!Number.isFinite(rise) || rise <= 0) return 0
  return (Math.atan(rise / 12) * 180) / Math.PI
}

export function roofSurfaceSqft(flatAreaSqft: number, pitchRise: number): number {
  if (!Number.isFinite(flatAreaSqft) || flatAreaSqft <= 0) return 0
  return flatAreaSqft * pitchMultiplierFromRise(pitchRise)
}

export type SlopedAreaFacetInput = {
  flat_area_sqft: number
  pitch_rise: number
  /** Google Solar stats.areaMeters2 converted to sqft (sloped roof area). */
  suggested_sloped_area_sqft?: number | null
  geometry_source?: string | null
}

/** Prefer Google segment sloped area for mask planes; else footprint × pitch multiplier. */
export function slopedAreaSqft(facet: SlopedAreaFacetInput): number {
  if (
    facet.geometry_source === 'solar_mask_plane' &&
    typeof facet.suggested_sloped_area_sqft === 'number' &&
    facet.suggested_sloped_area_sqft > 0
  ) {
    return Math.round(facet.suggested_sloped_area_sqft)
  }
  return Math.round(roofSurfaceSqft(facet.flat_area_sqft, facet.pitch_rise))
}

export function metersToFeet(meters: number): number {
  return meters * FEET_PER_METER
}

export function squareMetersToSquareFeet(squareMeters: number): number {
  return squareMeters * SQFT_PER_SQUARE_METER
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

export function haversineDistanceFeet(a: RoofMeasurePoint, b: RoofMeasurePoint): number {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)

  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng

  return metersToFeet(2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)))
}

export function polygonPerimeterFeet(points: RoofMeasurePoint[]): number {
  if (points.length < 2) return 0

  let total = 0
  for (let i = 0; i < points.length; i++) {
    total += haversineDistanceFeet(points[i], points[(i + 1) % points.length])
  }
  return total
}

export function approximatePlanarPolygonAreaSqft(points: RoofMeasurePoint[]): number {
  if (points.length < 3) return 0

  const origin = points[0]
  const lat0 = toRadians(origin.lat)
  const projected = points.map((point) => {
    const x = EARTH_RADIUS_METERS * toRadians(point.lng - origin.lng) * Math.cos(lat0)
    const y = EARTH_RADIUS_METERS * toRadians(point.lat - origin.lat)
    return { x, y }
  })

  let twiceArea = 0
  for (let i = 0; i < projected.length; i++) {
    const current = projected[i]
    const next = projected[(i + 1) % projected.length]
    twiceArea += current.x * next.y - next.x * current.y
  }

  return squareMetersToSquareFeet(Math.abs(twiceArea) / 2)
}

