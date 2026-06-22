import { createServiceClient } from '@/lib/supabase/service'
import { getRecentStormReportsInBbox } from '@/lib/roofradar-open-data'
import {
  DEFAULT_WEATHER_WINDOW_DAYS,
  footprintFromEnv,
  weatherOverlayFeatureEnabled,
} from '@/lib/weather-footprint'
import { fetchNwsWarningFeatures } from '@/lib/weather-nws'
import {
  finishWeatherRefreshRun,
  pruneWeatherRowsOlderThan,
  replaceWeatherCacheSnapshot,
  startWeatherRefreshRun,
  type WeatherCacheInsert,
} from '@/lib/weather-storage'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function verifyCronSecret(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron endpoint not configured' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const authFailure = verifyCronSecret(request)
  if (authFailure) return authFailure

  if (!weatherOverlayFeatureEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'weather overlay flag off' })
  }

  const admin = createServiceClient()
  const footprint = footprintFromEnv()
  const windowDays = DEFAULT_WEATHER_WINDOW_DAYS
  const refreshedAt = new Date().toISOString()
  const summary: Record<string, unknown> = { footprint, windowDays, refreshedAt }
  const errors: string[] = []

  let runId: string | null = null
  try {
    runId = await startWeatherRefreshRun(admin)
  } catch (err) {
    console.error('[cron/weather-refresh] failed to start run log:', err)
  }

  for (const layer of ['hail', 'wind'] as const) {
    try {
      const reports = await getRecentStormReportsInBbox(footprint, layer, windowDays)
      const rows: WeatherCacheInsert[] = reports.map((report) => ({
        layer,
        kind: 'report',
        event_date: report.date.toISOString().slice(0, 10),
        magnitude: report.magnitude,
        damage: report.damage,
        geometry: {
          type: 'Point',
          coordinates: [report.lng, report.lat],
        },
        footprint_bbox: footprint,
        source: 'iem',
        properties: {},
        refreshed_at: refreshedAt,
      }))
      const upserted = await replaceWeatherCacheSnapshot(admin, 'iem', layer, rows)
      summary[`iem_${layer}`] = { fetched: reports.length, upserted }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`iem_${layer}: ${message}`)
      console.error(`[cron/weather-refresh] iem ${layer} failed:`, message)
    }
  }

  for (const layer of ['hail', 'wind'] as const) {
    try {
      const warnings = await fetchNwsWarningFeatures(footprint, layer)
      const rows: WeatherCacheInsert[] = warnings.features
        .filter((feature) => feature.geometry)
        .map((feature) => ({
          layer,
          kind: 'warning' as const,
          event_date: null,
          magnitude: null,
          damage: false,
          geometry: feature.geometry as GeoJSON.Geometry,
          footprint_bbox: footprint,
          source: 'nws',
          properties: feature.properties,
          refreshed_at: refreshedAt,
        }))
      const upserted = await replaceWeatherCacheSnapshot(admin, 'nws', layer, rows)
      summary[`nws_${layer}`] = { fetched: warnings.features.length, upserted }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`nws_${layer}: ${message}`)
      console.error(`[cron/weather-refresh] nws ${layer} failed:`, message)
    }
  }

  try {
    await pruneWeatherRowsOlderThan(admin, windowDays)
    summary.prunedBefore = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(`prune: ${message}`)
  }

  const { count: swathCount } = await admin
    .from('weather_swaths')
    .select('id', { count: 'exact', head: true })

  summary.swaths = { totalRows: swathCount ?? 0 }

  const status: 'ok' | 'partial' | 'failed' =
    errors.length === 0 ? 'ok' : errors.length >= 5 ? 'failed' : 'partial'
  summary.errors = errors

  if (runId) {
    try {
      await finishWeatherRefreshRun(
        admin,
        runId,
        status,
        summary,
        errors.length ? errors.join('; ') : undefined,
      )
    } catch (err) {
      console.error('[cron/weather-refresh] failed to finish run log:', err)
    }
  }

  console.log('[cron/weather-refresh]', JSON.stringify(summary))
  return NextResponse.json({ ok: status !== 'failed', status, ...summary })
}
