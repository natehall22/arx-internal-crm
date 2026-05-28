/**
 * Google Solar DSM (Digital Surface Model) sampling for roof-measure QA.
 * dataLayers:get returns dsmUrl — float elevation raster per GeoTIFF spec:
 * https://developers.google.com/maps/documentation/solar/geotiff
 * https://developers.google.com/maps/documentation/solar/data-layers
 */
import * as geotiff from 'geotiff'
import geokeysToProj4 from 'geotiff-geokeys-to-proj4'
import proj4 from 'proj4'

const MAX_DSM_PIXELS = 4_000_000

export type SolarDataLayerUrls = {
  maskUrl: string | null
  dsmUrl: string | null
}

export type DsmFacetSample = {
  dsm_median_height_m: number | null
  pitch_suggested_from_dsm: number | null
  dsm_available: boolean
}

type DsmRaster = {
  band0: geotiff.TypedArray
  width: number
  height: number
  lngLatToColRow: (lat: number, lng: number) => { col: number; row: number } | null
}

function appendApiKeyToGeoTiffUrl(url: string, apiKey: string): string {
  if (url.includes('key=')) return url
  return url.includes('?') ? `${url}&key=${apiKey}` : `${url}?key=${apiKey}`
}

/** Fetch mask + DSM URLs from Google Solar dataLayers:get (IMAGERY_LAYERS view). */
export async function fetchSolarDataLayerUrls(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SolarDataLayerUrls> {
  const params = new URLSearchParams({
    'location.latitude': lat.toFixed(6),
    'location.longitude': lng.toFixed(6),
    radiusMeters: '100',
    view: 'IMAGERY_LAYERS',
    requiredQuality: 'BASE',
    exactQualityRequired: 'false',
    key: apiKey,
  })
  const url = `https://solar.googleapis.com/v1/dataLayers:get?${params}`
  const response = await fetch(url)
  if (!response.ok) {
    console.warn('[solar-dsm] dataLayers:get failed:', response.status)
    return { maskUrl: null, dsmUrl: null }
  }
  const data = (await response.json().catch(() => null)) as {
    maskUrl?: string
    dsmUrl?: string
    error?: { message?: string }
  } | null
  if (data?.error?.message) {
    console.warn('[solar-dsm] dataLayers error:', data.error.message)
    return { maskUrl: null, dsmUrl: null }
  }
  return {
    maskUrl: typeof data?.maskUrl === 'string' && data.maskUrl.length > 0 ? data.maskUrl : null,
    dsmUrl: typeof data?.dsmUrl === 'string' && data.dsmUrl.length > 0 ? data.dsmUrl : null,
  }
}

async function loadDsmRaster(dsmUrl: string, apiKey: string): Promise<DsmRaster | null> {
  const fetchUrl = appendApiKeyToGeoTiffUrl(dsmUrl, apiKey)
  const response = await fetch(fetchUrl)
  if (!response.ok) {
    console.warn('[solar-dsm] GeoTIFF fetch failed:', response.status)
    return null
  }
  const arrayBuffer = await response.arrayBuffer()
  const tiff = await geotiff.fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  if (width * height > MAX_DSM_PIXELS) {
    console.warn('[solar-dsm] DSM too large:', width, height)
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

  const fromWgs84 = proj4('+proj=longlat +datum=WGS84 +no_defs', projObj.proj4)
  const conv = projObj.coordinatesConversionParameters
  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()

  const lngLatToColRow = (lat: number, lng: number): { col: number; row: number } | null => {
    try {
      const projected = fromWgs84.forward([lng, lat])
      const c = geokeysToProj4.convertCoordinates(projected[0], projected[1], 0, conv)
      const col = (c.x - ox) / rx
      const row = (c.y - oy) / ry
      if (!Number.isFinite(col) || !Number.isFinite(row)) return null
      return { col: Math.round(col), row: Math.round(row) }
    } catch {
      return null
    }
  }

  const rasters = await image.readRasters()
  const band0 = rasters[0] as geotiff.TypedArray
  return { band0, width, height, lngLatToColRow }
}

function sampleHeightM(raster: DsmRaster, lat: number, lng: number): number | null {
  const px = raster.lngLatToColRow(lat, lng)
  if (!px) return null
  const { col, row } = px
  if (col < 0 || row < 0 || col >= raster.width || row >= raster.height) return null
  const v = Number(raster.band0[row * raster.width + col])
  return Number.isFinite(v) ? v : null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Estimate pitch (degrees) from DSM height drop along azimuth over ~half the facet span. */
export function pitchDegreesFromDsmHeights(
  heights: { lat: number; lng: number; h: number }[],
  azimuthDegrees: number | null
): number | null {
  if (heights.length < 2 || azimuthDegrees == null || !Number.isFinite(azimuthDegrees)) return null
  const az = (azimuthDegrees * Math.PI) / 180
  const ux = Math.sin(az)
  const uy = Math.cos(az)
  const cLat = heights.reduce((s, p) => s + p.lat, 0) / heights.length
  const cLng = heights.reduce((s, p) => s + p.lng, 0) / heights.length
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((cLat * Math.PI) / 180)

  let maxProj = -Infinity
  let minProj = Infinity
  let maxH = 0
  let minH = 0
  for (const p of heights) {
    const dx = (p.lng - cLng) * mPerDegLng
    const dy = (p.lat - cLat) * mPerDegLat
    const proj = dx * ux + dy * uy
    if (proj > maxProj) {
      maxProj = proj
      maxH = p.h
    }
    if (proj < minProj) {
      minProj = proj
      minH = p.h
    }
  }
  const runM = maxProj - minProj
  if (runM < 1.5) return null
  const riseM = maxH - minH
  const pitchRad = Math.atan2(Math.abs(riseM), runM)
  return (pitchRad * 180) / Math.PI
}

export async function sampleDsmForFacetVertices(
  dsmUrl: string,
  apiKey: string,
  vertices: { lat: number; lng: number }[],
  suggestedAzimuthDegrees: number | null
): Promise<DsmFacetSample> {
  const raster = await loadDsmRaster(dsmUrl, apiKey)
  if (!raster) {
    return { dsm_median_height_m: null, pitch_suggested_from_dsm: null, dsm_available: false }
  }

  const heights: number[] = []
  const heightPoints: { lat: number; lng: number; h: number }[] = []
  for (const v of vertices) {
    const h = sampleHeightM(raster, v.lat, v.lng)
    if (h != null) {
      heights.push(h)
      heightPoints.push({ lat: v.lat, lng: v.lng, h })
    }
  }

  if (heights.length === 0) {
    return { dsm_median_height_m: null, pitch_suggested_from_dsm: null, dsm_available: false }
  }

  return {
    dsm_median_height_m: median(heights),
    pitch_suggested_from_dsm: pitchDegreesFromDsmHeights(heightPoints, suggestedAzimuthDegrees),
    dsm_available: true,
  }
}

export const DSM_PITCH_DISAGREE_THRESHOLD_DEG = 3

export function dsmPitchDisagreesWithSolar(
  solarPitchDegrees: number | null,
  dsmPitchDegrees: number | null,
  thresholdDeg = DSM_PITCH_DISAGREE_THRESHOLD_DEG
): boolean {
  if (
    solarPitchDegrees == null ||
    dsmPitchDegrees == null ||
    !Number.isFinite(solarPitchDegrees) ||
    !Number.isFinite(dsmPitchDegrees)
  ) {
    return false
  }
  return Math.abs(solarPitchDegrees - dsmPitchDegrees) > thresholdDeg
}
