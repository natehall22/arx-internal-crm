/**
 * Linear lat/lng ↔ image pixel mapping for georeferenced rasters with known WGS84 bounds.
 * Used by roof fine-tune canvas (Solar RGB ~0.1 m/px over ~100 m footprint).
 */
import type { GeoBounds } from '@/lib/roof-measure-map-zoom'

export type LatLng = { lat: number; lng: number }

export function latLngToImagePixel(
  lat: number,
  lng: number,
  bounds: GeoBounds,
  width: number,
  height: number
): { x: number; y: number } {
  const lngSpan = bounds.east - bounds.west
  const latSpan = bounds.north - bounds.south
  if (lngSpan <= 0 || latSpan <= 0 || width <= 0 || height <= 0) {
    return { x: 0, y: 0 }
  }
  const x = ((lng - bounds.west) / lngSpan) * width
  const y = ((bounds.north - lat) / latSpan) * height
  return { x, y }
}

export function imagePixelToLatLng(
  x: number,
  y: number,
  bounds: GeoBounds,
  width: number,
  height: number
): LatLng {
  const lngSpan = bounds.east - bounds.west
  const latSpan = bounds.north - bounds.south
  const lng = bounds.west + (x / width) * lngSpan
  const lat = bounds.north - (y / height) * latSpan
  return { lat, lng }
}

export function boundsFromPoints(points: LatLng[]): GeoBounds | null {
  if (points.length === 0) return null
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const p of points) {
    north = Math.max(north, p.lat)
    south = Math.min(south, p.lat)
    east = Math.max(east, p.lng)
    west = Math.min(west, p.lng)
  }
  return { north, south, east, west }
}

/** Initial virtual zoom so facet bbox fills ~55% of the viewport. */
export function initialViewScaleForFacet(
  facetPoints: LatLng[],
  bounds: GeoBounds,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  const fb = boundsFromPoints(facetPoints)
  if (!fb) return 2.5

  const p0 = latLngToImagePixel(fb.north, fb.west, bounds, imageWidth, imageHeight)
  const p1 = latLngToImagePixel(fb.south, fb.east, bounds, imageWidth, imageHeight)
  const facetW = Math.max(8, Math.abs(p1.x - p0.x))
  const facetH = Math.max(8, Math.abs(p1.y - p0.y))

  const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight) * 0.92
  const facetScreenW = facetW * baseScale
  const facetScreenH = facetH * baseScale
  const fill = 0.55
  const scaleX = (canvasWidth * fill) / facetScreenW
  const scaleY = (canvasHeight * fill) / facetScreenH
  return Math.min(8, Math.max(2, Math.min(scaleX, scaleY)))
}
