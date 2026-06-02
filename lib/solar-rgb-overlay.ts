/**
 * Google Solar RGB GeoTIFF (0.1 m/px) → PNG + WGS84 bounds for map GroundOverlay.
 * Display-only — polygon vertex math stays on the base map in lat/lng.
 */
import * as geotiff from 'geotiff'
import geokeysToProj4 from 'geotiff-geokeys-to-proj4'
import proj4 from 'proj4'
import sharp from 'sharp'
import { fetchSolarDataLayerUrls } from '@/lib/solar-dsm'
import type { GeoBounds } from '@/lib/roof-measure-map-zoom'

const MAX_RGB_PIXELS = 4_000_000

export type SolarRgbOverlayPayload = {
  bounds: GeoBounds
  imageBase64: string
  width: number
  height: number
}

function appendApiKeyToGeoTiffUrl(url: string, apiKey: string): string {
  if (url.includes('key=')) return url
  return url.includes('?') ? `${url}&key=${apiKey}` : `${url}?key=${apiKey}`
}

function boundsFromCornerPixels(
  width: number,
  height: number,
  pixelToLngLat: (col: number, row: number) => { lat: number; lng: number }
): GeoBounds {
  const corners = [
    pixelToLngLat(0, 0),
    pixelToLngLat(width - 1, 0),
    pixelToLngLat(width - 1, height - 1),
    pixelToLngLat(0, height - 1),
  ]
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const c of corners) {
    north = Math.max(north, c.lat)
    south = Math.min(south, c.lat)
    east = Math.max(east, c.lng)
    west = Math.min(west, c.lng)
  }
  return { north, south, east, west }
}

async function loadRgbGeoTiffAsPng(
  rgbUrl: string,
  apiKey: string
): Promise<SolarRgbOverlayPayload | null> {
  const fetchUrl = appendApiKeyToGeoTiffUrl(rgbUrl, apiKey)
  const response = await fetch(fetchUrl)
  if (!response.ok) {
    console.warn('[solar-rgb] GeoTIFF fetch failed:', response.status)
    return null
  }

  const arrayBuffer = await response.arrayBuffer()
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  if (width * height > MAX_RGB_PIXELS) {
    console.warn('[solar-rgb] raster too large:', width, height)
    return null
  }

  const geoKeys = image.getGeoKeys()
  if (!geoKeys) {
    console.warn('[solar-rgb] missing geokeys')
    return null
  }

  let projObj: ReturnType<typeof geokeysToProj4.toProj4>
  try {
    projObj = geokeysToProj4.toProj4(geoKeys as Parameters<typeof geokeysToProj4.toProj4>[0])
  } catch (e) {
    console.warn('[solar-rgb] geokeysToProj4 failed:', e)
    return null
  }
  if (projObj.errors?.CRSNotSupported != null) {
    console.warn('[solar-rgb] CRS not supported')
    return null
  }

  const toWgs84 = proj4(projObj.proj4, '+proj=longlat +datum=WGS84 +no_defs')
  const conv = projObj.coordinatesConversionParameters
  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()

  const pixelToLngLat = (col: number, row: number) => {
    const gx = ox + col * rx
    const gy = oy + row * ry
    const c = geokeysToProj4.convertCoordinates(gx, gy, 0, conv)
    const projected = toWgs84.forward([c.x, c.y])
    return { lat: projected[1], lng: projected[0] }
  }

  const bounds = boundsFromCornerPixels(width, height, pixelToLngLat)
  const rasters = await image.readRasters()
  const bandCount = rasters.length

  const rgba = Buffer.alloc(width * height * 4)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col
      const out = idx * 4
      if (bandCount >= 3) {
        const r = (rasters[0] as geotiff.TypedArray)[idx]
        const g = (rasters[1] as geotiff.TypedArray)[idx]
        const b = (rasters[2] as geotiff.TypedArray)[idx]
        rgba[out] = clampByte(r)
        rgba[out + 1] = clampByte(g)
        rgba[out + 2] = clampByte(b)
        rgba[out + 3] = 255
      } else {
        const v = (rasters[0] as geotiff.TypedArray)[idx]
        rgba[out] = clampByte(v)
        rgba[out + 1] = clampByte(v)
        rgba[out + 2] = clampByte(v)
        rgba[out + 3] = 255
      }
    }
  }

  const pngBuffer = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()

  return {
    bounds,
    imageBase64: pngBuffer.toString('base64'),
    width,
    height,
  }
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

/** Fetch Solar RGB overlay for roof-measure HD fine-tuning view. */
export async function fetchSolarRgbOverlayPayload(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SolarRgbOverlayPayload | null> {
  const layers = await fetchSolarDataLayerUrls(lat, lng, apiKey)
  if (!layers.rgbUrl) return null
  return loadRgbGeoTiffAsPng(layers.rgbUrl, apiKey)
}
