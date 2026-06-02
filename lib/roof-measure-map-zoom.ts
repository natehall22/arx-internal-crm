/**
 * Zoom helpers for roof-measure vertex editing.
 * Interactive map zoom is independent of detect-roof solar mask georef (GeoTIFF CRS).
 */

export const ROOF_MEASURE_MAP_MAX_ZOOM = 23
/** Preferred zoom when framing a roof for vertex fine-tuning (Aurora-style close-up). */
export const ROOF_MEASURE_EDIT_ZOOM_TARGET = 22

export type LatLngPoint = { lat: number; lng: number }

export type GeoBounds = {
  north: number
  south: number
  east: number
  west: number
}

/**
 * Pick the highest practical edit zoom for a location without exceeding imagery limits.
 * When MaxZoomService reports < 22, use whatever is available.
 */
export function resolveEditZoom(maxAvailable?: number | null): number {
  const available =
    typeof maxAvailable === 'number' && maxAvailable > 0
      ? Math.min(maxAvailable, ROOF_MEASURE_MAP_MAX_ZOOM)
      : ROOF_MEASURE_EDIT_ZOOM_TARGET
  return Math.min(available, Math.max(ROOF_MEASURE_EDIT_ZOOM_TARGET, available))
}

export function boundsFromPoints(points: LatLngPoint[]): GeoBounds | null {
  if (points.length === 0) return null
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    north = Math.max(north, p.lat)
    south = Math.min(south, p.lat)
    east = Math.max(east, p.lng)
    west = Math.min(west, p.lng)
  }
  if (!Number.isFinite(north)) return null
  return { north, south, east, west }
}

/** Expand bounds by a fraction of span (minimum pad in degrees for tiny facets). */
export function expandBounds(bounds: GeoBounds, paddingRatio = 0.08, minPadDegrees = 0.000015): GeoBounds {
  const latSpan = Math.max(bounds.north - bounds.south, minPadDegrees)
  const lngSpan = Math.max(bounds.east - bounds.west, minPadDegrees)
  const latPad = Math.max(latSpan * paddingRatio, minPadDegrees)
  const lngPad = Math.max(lngSpan * paddingRatio, minPadDegrees)
  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    west: bounds.west - lngPad,
  }
}

/** Stable auto-detect key — fractional scroll zoom should not re-trigger detect. */
export function roundedZoomForDetectKey(zoom: number): number {
  return Math.round(zoom)
}
