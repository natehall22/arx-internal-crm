/**
 * Point-in-swath matching with a distance buffer.
 *
 * MRMS hail swaths (`weather_swaths.geometry`) are GeoJSON Polygons covering the
 * modelled footprint of a storm. An address counts as "hit" when it falls inside
 * the polygon OR within {@link STORM_SWATH_BUFFER_MILES} of its boundary — the
 * buffer absorbs MRMS grid resolution (~1km) and geocoding drift so a house on
 * the edge of a band is not silently skipped.
 *
 * Distances use an equirectangular approximation scaled by latitude. At the
 * ~1-mile scale this matching operates on, the error versus haversine is well
 * under a foot — and the whole match is an estimate regardless.
 */

const EARTH_RADIUS_MILES = 3958.7613
const DEG_TO_RAD = Math.PI / 180

/** Distance outside a swath polygon that still counts as impacted. */
export const STORM_SWATH_BUFFER_MILES = 1

/**
 * MESH-derived swaths over-report at low thresholds — a 0.25in floor would paint
 * most of the county. 0.75in is the conventional damaging-hail cutoff.
 */
export const STORM_SWATH_HAIL_MIN_INCHES = 0.75

export type LngLat = [number, number]

export type SwathMatch = {
  /** 0 when the point is inside the polygon, else miles to the nearest boundary. */
  distanceMiles: number
  inside: boolean
}

function milesPerDegreeLng(latDeg: number): number {
  return (Math.PI / 180) * EARTH_RADIUS_MILES * Math.cos(latDeg * DEG_TO_RAD)
}

const MILES_PER_DEGREE_LAT = (Math.PI / 180) * EARTH_RADIUS_MILES

/** Distance in miles from point P to segment AB, all in [lng, lat] degrees. */
function distanceToSegmentMiles(
  lng: number,
  lat: number,
  a: LngLat,
  b: LngLat,
  mPerDegLng: number
): number {
  // Project to a local miles plane so the segment math is plain Euclidean.
  const px = lng * mPerDegLng
  const py = lat * MILES_PER_DEGREE_LAT
  const ax = a[0] * mPerDegLng
  const ay = a[1] * MILES_PER_DEGREE_LAT
  const bx = b[0] * mPerDegLng
  const by = b[1] * MILES_PER_DEGREE_LAT

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay)
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Even-odd ray casting across every ring. Passing holes through the same
 * accumulator is what makes a point inside a hole read as outside the polygon.
 */
function isInsideRings(lng: number, lat: number, rings: LngLat[][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      const crosses = yi > lat !== yj > lat
      if (!crosses) continue
      const xIntersect = ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (lng < xIntersect) inside = !inside
    }
  }
  return inside
}

function minDistanceToRingsMiles(lng: number, lat: number, rings: LngLat[][]): number {
  const mPerDegLng = milesPerDegreeLng(lat)
  let min = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const d = distanceToSegmentMiles(lng, lat, ring[j], ring[i], mPerDegLng)
      if (d < min) min = d
    }
  }
  return min
}

/** Flatten a Polygon / MultiPolygon into groups of rings (one group per polygon). */
export function polygonRingGroups(geometry: unknown): LngLat[][][] {
  const geom = geometry as { type?: string; coordinates?: unknown }
  if (!geom || typeof geom.type !== 'string') return []

  if (geom.type === 'Polygon') {
    const rings = geom.coordinates as LngLat[][] | undefined
    return Array.isArray(rings) && rings.length ? [rings] : []
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates as LngLat[][][] | undefined
    return Array.isArray(polys) ? polys.filter((rings) => Array.isArray(rings) && rings.length) : []
  }
  return []
}

/**
 * Match a coordinate against a swath geometry, allowing `bufferMiles` of slop
 * outside the boundary. Returns null when the point is neither inside nor within
 * the buffer, or when the geometry is not polygonal.
 */
export function matchPointToSwathGeometry(
  lat: number,
  lng: number,
  geometry: unknown,
  bufferMiles: number = STORM_SWATH_BUFFER_MILES
): SwathMatch | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const groups = polygonRingGroups(geometry)
  if (!groups.length) return null

  let nearest = Infinity

  for (const rings of groups) {
    const valid = rings.filter((ring) => Array.isArray(ring) && ring.length >= 3)
    if (!valid.length) continue

    if (isInsideRings(lng, lat, valid)) {
      return { distanceMiles: 0, inside: true }
    }

    const d = minDistanceToRingsMiles(lng, lat, valid)
    if (d < nearest) nearest = d
  }

  if (nearest <= bufferMiles) {
    return { distanceMiles: nearest, inside: false }
  }
  return null
}
