const NC_ONEMAP_LATEST_IMAGE_SERVER =
  'https://services.gis.nc.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer'

export type GeographicBounds = {
  north: number
  south: number
  east: number
  west: number
}

export type NcOneMapOverlayPayload = {
  bounds: GeographicBounds
  imageBase64: string
  width: number
  height: number
  source: 'nc_onemap_latest'
  acquisitionDate: string | null
  resolutionMeters: number
}

type ArcGisExportResponse = {
  href?: unknown
  error?: { message?: unknown }
}

type ArcGisIdentifyResponse = {
  catalogItems?: {
    features?: Array<{ attributes?: Record<string, unknown> }>
  }
  catalogItemVisibilities?: unknown[]
}

/** Small property frame; 150 m square gives ~15 cm/px at 1024px. */
export function propertyBounds(
  lat: number,
  lng: number,
  radiusMeters = 75,
): GeographicBounds {
  const latDelta = radiusMeters / 111_320
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const lngDelta = radiusMeters / (111_320 * cosLat)
  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta,
  }
}

export function parseArcGisDate(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function bboxString(bounds: GeographicBounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].join(',')
}

async function fetchAcquisitionDate(lat: number, lng: number): Promise<string | null> {
  const url = new URL(`${NC_ONEMAP_LATEST_IMAGE_SERVER}/identify`)
  url.searchParams.set('f', 'json')
  url.searchParams.set(
    'geometry',
    JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
  )
  url.searchParams.set('geometryType', 'esriGeometryPoint')
  url.searchParams.set('returnGeometry', 'false')
  url.searchParams.set('returnCatalogItems', 'true')

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as ArcGisIdentifyResponse
    const features = payload.catalogItems?.features || []
    const visibleIndex = payload.catalogItemVisibilities?.findIndex((value) => value === 1) ?? -1
    const selected = visibleIndex >= 0 ? features[visibleIndex] : features.find((feature) =>
      parseArcGisDate(feature.attributes?.date),
    )
    return parseArcGisDate(selected?.attributes?.date)
  } catch {
    return null
  }
}

export async function fetchNcOneMapOverlay(
  lat: number,
  lng: number,
): Promise<NcOneMapOverlayPayload> {
  const bounds = propertyBounds(lat, lng)
  const width = 1024
  const height = 1024
  const exportUrl = new URL(`${NC_ONEMAP_LATEST_IMAGE_SERVER}/exportImage`)
  exportUrl.searchParams.set('f', 'json')
  exportUrl.searchParams.set('bbox', bboxString(bounds))
  exportUrl.searchParams.set('bboxSR', '4326')
  exportUrl.searchParams.set('imageSR', '4326')
  exportUrl.searchParams.set('size', `${width},${height}`)
  exportUrl.searchParams.set('format', 'png')
  exportUrl.searchParams.set('interpolation', 'RSP_BilinearInterpolation')

  const [exportResponse, acquisitionDate] = await Promise.all([
    fetch(exportUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }),
    fetchAcquisitionDate(lat, lng),
  ])
  if (!exportResponse.ok) {
    throw new Error(`NC aerial export failed (${exportResponse.status})`)
  }

  const exportPayload = (await exportResponse.json()) as ArcGisExportResponse
  if (typeof exportPayload.href !== 'string' || !exportPayload.href.startsWith('https://')) {
    const detail =
      typeof exportPayload.error?.message === 'string' ? `: ${exportPayload.error.message}` : ''
    throw new Error(`NC aerial imagery unavailable${detail}`)
  }

  const imageResponse = await fetch(exportPayload.href, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  if (!imageResponse.ok) {
    throw new Error(`NC aerial image failed (${imageResponse.status})`)
  }
  const contentType = imageResponse.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) {
    throw new Error('NC aerial service returned a non-image response')
  }
  const image = Buffer.from(await imageResponse.arrayBuffer())
  if (image.length === 0 || image.length > 12 * 1024 * 1024) {
    throw new Error('NC aerial image response size was invalid')
  }

  return {
    bounds,
    imageBase64: image.toString('base64'),
    width,
    height,
    source: 'nc_onemap_latest',
    acquisitionDate,
    resolutionMeters: 0.1524,
  }
}
