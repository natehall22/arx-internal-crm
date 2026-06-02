/**
 * Google Solar RGB GeoTIFF (0.1 m/px) → PNG + WGS84 bounds for fine-tune editor.
 * Falls back to Static Maps satellite when Solar RGB is missing or blank.
 */
import * as geotiff from 'geotiff'
import geokeysToProj4 from 'geotiff-geokeys-to-proj4'
import proj4 from 'proj4'
import sharp from 'sharp'
import { fetchSolarDataLayerUrls } from '@/lib/solar-dsm'
import type { GeoBounds } from '@/lib/roof-measure-map-zoom'
import {
  clampVisionAlignStaticZoom,
  staticMapImageBounds,
} from '@/lib/static-satellite-map'
import { fetchStaticSatelliteMapPngBase64 } from '@/lib/static-satellite-map.server'

const MAX_RGB_PIXELS = 16_000_000
const MAX_OUTPUT_SIDE = 1280

export type SolarRgbOverlayPayload = {
  bounds: GeoBounds
  imageBase64: string
  width: number
  height: number
  /** Where the bitmap came from — client may show a hint when static fallback is used. */
  source: 'solar_rgb' | 'static_map'
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

async function geotiffBoundsFromBuffer(arrayBuffer: ArrayBuffer): Promise<{
  bounds: GeoBounds
  width: number
  height: number
} | null> {
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  if (width * height > MAX_RGB_PIXELS) {
    console.warn('[solar-rgb] raster too large:', width, height)
    return null
  }

  const geoKeys = image.getGeoKeys()
  if (!geoKeys) return null

  let projObj: ReturnType<typeof geokeysToProj4.toProj4>
  try {
    projObj = geokeysToProj4.toProj4(geoKeys as Parameters<typeof geokeysToProj4.toProj4>[0])
  } catch {
    return null
  }
  if (projObj.errors?.CRSNotSupported != null) return null

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

  return { bounds: boundsFromCornerPixels(width, height, pixelToLngLat), width, height }
}

async function pngFromGeoTiffBuffer(arrayBuffer: ArrayBuffer): Promise<Buffer | null> {
  try {
    return await sharp(Buffer.from(arrayBuffer), { limitInputPixels: MAX_RGB_PIXELS })
      .ensureAlpha()
      .resize(MAX_OUTPUT_SIDE, MAX_OUTPUT_SIDE, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer()
  } catch (e) {
    console.warn('[solar-rgb] sharp geotiff decode failed:', e)
    return null
  }
}

/** Reject empty / all-black decode results so we can fall back to Static Maps. */
async function pngHasVisibleImagery(png: Buffer): Promise<boolean> {
  try {
    const stats = await sharp(png).stats()
    const channels = stats.channels.slice(0, 3)
    if (channels.length === 0) return false
    const maxChannelMean = Math.max(...channels.map((c) => c.mean))
    return maxChannelMean > 4
  } catch {
    return false
  }
}

async function loadRgbGeoTiffAsPng(rgbUrl: string, apiKey: string): Promise<SolarRgbOverlayPayload | null> {
  const fetchUrl = appendApiKeyToGeoTiffUrl(rgbUrl, apiKey)
  const response = await fetch(fetchUrl)
  if (!response.ok) {
    console.warn('[solar-rgb] GeoTIFF fetch failed:', response.status)
    return null
  }

  const arrayBuffer = await response.arrayBuffer()
  const geo = await geotiffBoundsFromBuffer(arrayBuffer)
  if (!geo) return null

  const pngBuffer = await pngFromGeoTiffBuffer(arrayBuffer)
  if (!pngBuffer || !(await pngHasVisibleImagery(pngBuffer))) return null

  const meta = await sharp(pngBuffer).metadata()
  const width = meta.width ?? geo.width
  const height = meta.height ?? geo.height

  return {
    bounds: geo.bounds,
    imageBase64: pngBuffer.toString('base64'),
    width,
    height,
    source: 'solar_rgb',
  }
}

async function staticMapOverlayPayload(lat: number, lng: number): Promise<SolarRgbOverlayPayload> {
  const zoom = clampVisionAlignStaticZoom(22)
  const sizeW = 640
  const sizeH = 640
  const imageBase64 = await fetchStaticSatelliteMapPngBase64({ lat, lng, zoom, sizeW, sizeH })
  const width = sizeW * 2
  const height = sizeH * 2
  const bounds = staticMapImageBounds(lat, lng, zoom, width, height)
  return { bounds, imageBase64, width, height, source: 'static_map' }
}

/** Fetch HD overlay for roof-measure super zoom; always returns imagery (Solar or Static Maps). */
export async function fetchSolarRgbOverlayPayload(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SolarRgbOverlayPayload> {
  try {
    const layers = await fetchSolarDataLayerUrls(lat, lng, apiKey)
    if (layers.rgbUrl) {
      const solar = await loadRgbGeoTiffAsPng(layers.rgbUrl, apiKey)
      if (solar) return solar
    }
  } catch (e) {
    console.warn('[solar-rgb] solar path failed:', e)
  }
  return staticMapOverlayPayload(lat, lng)
}
