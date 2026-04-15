/**
 * GeoJSON Polygon / MultiPolygon → point-in-polygon for canvass territory filtering (trial MVP).
 * Coordinates use [lng, lat] per RFC 7946.
 */

export type LngLatRing = [number, number][]

/** Ray-casting; ring is closed or unclosed (last point may duplicate first). */
export function pointInRing(lng: number, lat: number, ring: LngLatRing): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const crossesMeridian = (yi > lat) !== (yj > lat)
    if (crossesMeridian) {
      const dy = yj - yi
      if (Math.abs(dy) > 1e-12) {
        const xAt = ((xj - xi) * (lat - yi)) / dy + xi
        if (lng < xAt) inside = !inside
      }
    }
  }
  return inside
}

export function pointInAnyExteriorRing(lng: number, lat: number, rings: LngLatRing[]): boolean {
  for (const ring of rings) {
    if (pointInRing(lng, lat, ring)) return true
  }
  return false
}

/** Extract exterior rings from GeoJSON Polygon or MultiPolygon (ignores holes for MVP). */
export function exteriorRingsFromGeoJSON(geo: unknown): LngLatRing[] {
  if (!geo || typeof geo !== 'object') return []
  const g = geo as { type?: string; coordinates?: unknown }
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const coords = g.coordinates as number[][][]
    const outer = coords[0]
    if (!outer?.length) return []
    return [outer.map((p) => [p[0], p[1]] as [number, number])]
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const multi = g.coordinates as number[][][][]
    const rings: LngLatRing[] = []
    for (const poly of multi) {
      const outer = poly[0]
      if (outer?.length) {
        rings.push(outer.map((p) => [p[0], p[1]] as [number, number]))
      }
    }
    return rings
  }
  return []
}

export function isValidBoundaryGeoJSON(geo: unknown): boolean {
  return exteriorRingsFromGeoJSON(geo).length > 0
}
