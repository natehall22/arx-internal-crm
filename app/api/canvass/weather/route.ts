import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { clampQueryBbox, clampWindowDays } from '@/lib/weather-footprint'
import { fetchNwsWarningFeatures } from '@/lib/weather-nws'
import {
  isActiveWeatherWarning,
  maxIsoTimestamp,
  readWeatherCacheFeatures,
  readWeatherSwathFeatures,
  type WeatherGeoFeature,
} from '@/lib/weather-storage'
import { getRecentStormReportsInBbox } from '@/lib/roofradar-open-data'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CACHE_MS = 1000 * 60 * 30

type Bbox = { n: number; s: number; e: number; w: number }

type WeatherResponse = {
  type: 'FeatureCollection'
  features: WeatherGeoFeature[]
  refreshedAt: string
  stale?: boolean
  degraded?: boolean
}

const responseCache = new Map<string, { expiresAt: number; body: WeatherResponse }>()

function emptyResponse(degraded = false): WeatherResponse {
  return {
    type: 'FeatureCollection',
    features: [],
    refreshedAt: new Date().toISOString(),
    ...(degraded ? { degraded: true } : {}),
  }
}

/** Re-filter cached warnings so expired alerts are not served from the in-memory cache. */
function filterCachedResponse(body: WeatherResponse): WeatherResponse {
  const features = body.features.filter(
    (f) => f.properties.kind !== 'warning' || isActiveWeatherWarning(f.properties),
  )
  if (features.length === body.features.length) return body
  return { ...body, features }
}

function parseBbox(searchParams: URLSearchParams): Bbox | null {
  const raw = {
    n: Number(searchParams.get('n')),
    s: Number(searchParams.get('s')),
    e: Number(searchParams.get('e')),
    w: Number(searchParams.get('w')),
  }
  return clampQueryBbox(raw)
}

function parseLayer(value: string | null): 'hail' | 'wind' | null {
  if (value === 'hail' || value === 'wind') return value
  return null
}

function liveIemFeatures(
  reports: Awaited<ReturnType<typeof getRecentStormReportsInBbox>>,
  layer: 'hail' | 'wind',
): WeatherGeoFeature[] {
  return reports.map((report) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [report.lng, report.lat],
    },
    properties: {
      kind: 'report',
      layer,
      magnitude: report.magnitude,
      damage: report.damage,
      date: report.date.toISOString(),
      source: 'iem',
    },
  }))
}

function warningFeaturesForResponse(
  cached: WeatherGeoFeature[],
  live: { features: WeatherGeoFeature[]; live: boolean },
): WeatherGeoFeature[] {
  if (live.live) return live.features.filter((f) => isActiveWeatherWarning(f.properties))
  return cached.filter(
    (f) => f.properties.kind === 'warning' && isActiveWeatherWarning(f.properties),
  )
}

export async function GET(request: NextRequest) {
  try {
    await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const bbox = parseBbox(searchParams)
  const layer = parseLayer(searchParams.get('layer'))
  const windowDays = clampWindowDays(searchParams.get('windowDays'))

  if (!bbox || !layer) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  // Round bbox edges in the key so small pans reuse a cache entry (bounds key cardinality).
  const k = (v: number) => v.toFixed(2)
  const cacheKey = `${k(bbox.n)}|${k(bbox.s)}|${k(bbox.e)}|${k(bbox.w)}|${layer}|${windowDays}`
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(filterCachedResponse(cached.body))
  }

  try {
    const admin = createServiceClient()
    const [cacheRead, swathRead, liveWarnings] = await Promise.all([
      readWeatherCacheFeatures(admin, bbox, layer, windowDays),
      // Isolate the swath read: a single malformed swath row (or a DB timeout once
      // the table holds 2 years of rows) must degrade ONLY swaths, never take down
      // reports + live NWS warnings with it.
      layer === 'hail'
        ? readWeatherSwathFeatures(admin, bbox, layer, windowDays).catch(() => ({
            features: [],
            refreshedAt: null,
          }))
        : Promise.resolve({ features: [], refreshedAt: null }),
      fetchNwsWarningFeatures(bbox, layer),
    ])

    let reportFeatures = cacheRead.features.filter((f) => f.properties.kind === 'report')
    let refreshedAt = maxIsoTimestamp(cacheRead.refreshedAt, swathRead.refreshedAt)
    let stale = false

    if (refreshedAt) {
      const ageMs = Date.now() - new Date(refreshedAt).getTime()
      stale = ageMs > 36 * 3600000
    }

    if (!reportFeatures.length) {
      const liveReports = await getRecentStormReportsInBbox(bbox, layer, windowDays)
      reportFeatures = liveIemFeatures(liveReports, layer)
      refreshedAt = maxIsoTimestamp(refreshedAt, new Date().toISOString())
    }

    const warningFeatures = warningFeaturesForResponse(cacheRead.features, liveWarnings)
    const features = [
      ...reportFeatures,
      ...warningFeatures,
      ...swathRead.features,
    ]

    const body: WeatherResponse = {
      type: 'FeatureCollection',
      features,
      refreshedAt: refreshedAt || new Date().toISOString(),
      ...(stale ? { stale: true } : {}),
    }

    // Evict expired entries before inserting so the in-memory cache can't grow unbounded.
    if (responseCache.size > 200) {
      const now = Date.now()
      responseCache.forEach((val, key) => {
        if (val.expiresAt <= now) responseCache.delete(key)
      })
    }
    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, body })
    return NextResponse.json(body)
  } catch {
    return NextResponse.json(emptyResponse(true))
  }
}
