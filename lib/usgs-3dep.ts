const USGS_LIDAR_INDEX_QUERY =
  'https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/8/query'

export type UsgsLidarCollection = {
  workunit: string
  project: string
  collectStart: string | null
  collectEnd: string | null
  qualityLevel: string
  specification: string
  category: string
  reason: string
  pointCloudUrl: string | null
  metadataUrl: string | null
}

export type UsgsLidarAvailability = {
  available: boolean
  selected: UsgsLidarCollection | null
  collections: UsgsLidarCollection[]
}

type ArcGisFeature = { attributes?: Record<string, unknown> }
type ArcGisResponse = {
  features?: ArcGisFeature[]
  error?: { message?: unknown }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function urlOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') ? value : null
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

export function qualityRank(qualityLevel: string): number {
  const match = qualityLevel.match(/\bQL\s*([0-3])\b/i)
  return match ? 4 - Number(match[1]) : 0
}

function categoryRank(category: string): number {
  const normalized = category.toLowerCase()
  if (normalized === 'meets') return 3
  if (normalized === 'meets with variance') return 2
  if (normalized.includes('provisional')) return 1
  return 0
}

export function selectBestLidarCollection(
  collections: UsgsLidarCollection[],
): UsgsLidarCollection | null {
  return (
    [...collections].sort((a, b) => {
      const categoryDelta = categoryRank(b.category) - categoryRank(a.category)
      if (categoryDelta !== 0) return categoryDelta
      const qualityDelta = qualityRank(b.qualityLevel) - qualityRank(a.qualityLevel)
      if (qualityDelta !== 0) return qualityDelta
      return (b.collectEnd || '').localeCompare(a.collectEnd || '')
    })[0] || null
  )
}

export async function fetchUsgsLidarAvailability(
  lat: number,
  lng: number,
): Promise<UsgsLidarAvailability> {
  const url = new URL(USGS_LIDAR_INDEX_QUERY)
  url.searchParams.set('f', 'json')
  url.searchParams.set('geometry', `${lng},${lat}`)
  url.searchParams.set('geometryType', 'esriGeometryPoint')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set(
    'outFields',
    [
      'workunit',
      'project',
      'collect_start',
      'collect_end',
      'ql',
      'spec',
      'lpc_category',
      'lpc_reason',
      'lpc_link',
      'metadata_link',
    ].join(','),
  )
  url.searchParams.set('returnGeometry', 'false')

  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`USGS lidar lookup failed (${response.status})`)
  }
  const payload = (await response.json()) as ArcGisResponse
  if (!Array.isArray(payload.features)) {
    const detail = typeof payload.error?.message === 'string' ? `: ${payload.error.message}` : ''
    throw new Error(`USGS lidar lookup returned an invalid response${detail}`)
  }

  const collections = payload.features.map(({ attributes = {} }) => ({
    workunit: text(attributes.workunit),
    project: text(attributes.project),
    collectStart: dateOrNull(attributes.collect_start),
    collectEnd: dateOrNull(attributes.collect_end),
    qualityLevel: text(attributes.ql) || 'Unknown',
    specification: text(attributes.spec),
    category: text(attributes.lpc_category),
    reason: text(attributes.lpc_reason),
    pointCloudUrl: urlOrNull(attributes.lpc_link),
    metadataUrl: urlOrNull(attributes.metadata_link),
  }))
  const selected = selectBestLidarCollection(collections)
  return { available: selected != null, selected, collections }
}
