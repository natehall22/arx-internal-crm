import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bboxesOverlap,
  clampWindowDays,
  type WeatherBbox,
} from '@/lib/weather-footprint'

export type WeatherLayer = 'hail' | 'wind'

export type WeatherCacheRow = {
  id: string
  layer: WeatherLayer
  kind: 'report' | 'warning'
  event_date: string | null
  magnitude: number | null
  damage: boolean | null
  geometry: GeoJSON.Geometry
  footprint_bbox: WeatherBbox | null
  source: string
  properties: Record<string, unknown> | null
  refreshed_at: string
}

export type WeatherSwathRow = {
  id: string
  event_date: string
  layer: WeatherLayer
  magnitude: number
  geometry: GeoJSON.Geometry
  source: string
  refreshed_at: string
}

export type WeatherGeoFeature = {
  type: 'Feature'
  geometry: GeoJSON.Geometry | null
  properties: Record<string, unknown>
}

function collectCoordinates(geometry: GeoJSON.Geometry, coords: Array<[number, number]>) {
  switch (geometry.type) {
    case 'Point':
      coords.push([geometry.coordinates[0], geometry.coordinates[1]])
      break
    case 'MultiPoint':
      geometry.coordinates.forEach((c) => coords.push([c[0], c[1]]))
      break
    case 'LineString':
      geometry.coordinates.forEach((c) => coords.push([c[0], c[1]]))
      break
    case 'MultiLineString':
      geometry.coordinates.forEach((line) => line.forEach((c) => coords.push([c[0], c[1]])))
      break
    case 'Polygon':
      geometry.coordinates.forEach((ring) => ring.forEach((c) => coords.push([c[0], c[1]])))
      break
    case 'MultiPolygon':
      geometry.coordinates.forEach((poly) =>
        poly.forEach((ring) => ring.forEach((c) => coords.push([c[0], c[1]]))),
      )
      break
    default:
      break
  }
}

export function geometryIntersectsBbox(geometry: GeoJSON.Geometry | null, bbox: WeatherBbox) {
  if (!geometry) return false
  const coords: Array<[number, number]> = []
  collectCoordinates(geometry, coords)
  if (!coords.length) return false
  let n = -Infinity
  let s = Infinity
  let e = -Infinity
  let w = Infinity
  for (const [lng, lat] of coords) {
    if (lat > n) n = lat
    if (lat < s) s = lat
    if (lng > e) e = lng
    if (lng < w) w = lng
  }
  return bboxesOverlap(bbox, { n, s, e, w })
}

function cutoffDateIso(windowDays: number) {
  const cutoff = new Date(Date.now() - windowDays * 86400000)
  return cutoff.toISOString().slice(0, 10)
}

/** Drop cached NWS warnings whose expires timestamp is in the past. */
export function isActiveWeatherWarning(properties: Record<string, unknown> | null | undefined): boolean {
  const expires = properties?.expires
  if (!expires) return true
  const expMs = new Date(String(expires)).getTime()
  if (Number.isNaN(expMs)) return true
  return expMs > Date.now()
}

export function cacheRowToFeature(row: WeatherCacheRow): WeatherGeoFeature {
  return {
    type: 'Feature',
    geometry: row.geometry,
    properties: {
      kind: row.kind,
      layer: row.layer,
      magnitude: row.magnitude ?? undefined,
      damage: row.damage ?? undefined,
      date: row.event_date ? `${row.event_date}T12:00:00.000Z` : undefined,
      source: row.source,
      ...(row.properties || {}),
    },
  }
}

export function swathRowToFeature(row: WeatherSwathRow): WeatherGeoFeature {
  return {
    type: 'Feature',
    geometry: row.geometry,
    properties: {
      kind: 'swath',
      layer: row.layer,
      magnitude: row.magnitude,
      date: `${row.event_date}T12:00:00.000Z`,
      source: row.source,
    },
  }
}

export async function readWeatherCacheFeatures(
  admin: SupabaseClient,
  bbox: WeatherBbox,
  layer: WeatherLayer,
  windowDays: number,
): Promise<{ features: WeatherGeoFeature[]; refreshedAt: string | null }> {
  const cutoff = cutoffDateIso(clampWindowDays(windowDays))
  const { data, error } = await admin
    .from('weather_cache')
    .select(
      'id, layer, kind, event_date, magnitude, damage, geometry, footprint_bbox, source, properties, refreshed_at',
    )
    .eq('layer', layer)
    .or(`event_date.gte.${cutoff},event_date.is.null`)
    .order('refreshed_at', { ascending: false })
    .limit(5000)

  if (error || !data?.length) {
    return { features: [], refreshedAt: null }
  }

  let refreshedAt: string | null = null
  const features: WeatherGeoFeature[] = []
  for (const raw of data) {
    const row = raw as WeatherCacheRow
    if (row.kind === 'warning' && !isActiveWeatherWarning(row.properties)) continue
    if (!geometryIntersectsBbox(row.geometry, bbox)) continue
    if (!refreshedAt || row.refreshed_at > refreshedAt) refreshedAt = row.refreshed_at
    features.push(cacheRowToFeature(row))
  }

  return { features, refreshedAt }
}

export async function readWeatherSwathFeatures(
  admin: SupabaseClient,
  bbox: WeatherBbox,
  layer: WeatherLayer,
  windowDays: number,
): Promise<{ features: WeatherGeoFeature[]; refreshedAt: string | null }> {
  const cutoff = cutoffDateIso(clampWindowDays(windowDays))
  // 5000 cap: 730-day window × ~8 hail bands/day can exceed 2000 rows for the
  // Cabarrus footprint before client-side bbox filter; newest/largest kept first.
  const { data, error } = await admin
    .from('weather_swaths')
    .select('id, event_date, layer, magnitude, geometry, source, refreshed_at')
    .eq('layer', layer)
    .gte('event_date', cutoff)
    .order('event_date', { ascending: false })
    .order('magnitude', { ascending: false })
    .limit(5000)

  if (error || !data?.length) {
    return { features: [], refreshedAt: null }
  }

  let refreshedAt: string | null = null
  const features: WeatherGeoFeature[] = []
  for (const raw of data) {
    const row = raw as WeatherSwathRow
    if (!geometryIntersectsBbox(row.geometry, bbox)) continue
    if (!refreshedAt || row.refreshed_at > refreshedAt) refreshedAt = row.refreshed_at
    features.push(swathRowToFeature(row))
  }

  return { features, refreshedAt }
}

export type WeatherCacheInsert = {
  layer: WeatherLayer
  kind: 'report' | 'warning'
  event_date: string | null
  magnitude: number | null
  damage?: boolean
  geometry: GeoJSON.Geometry
  footprint_bbox: WeatherBbox
  source: string
  properties?: Record<string, unknown>
  refreshed_at?: string
}

export async function replaceWeatherCacheSnapshot(
  admin: SupabaseClient,
  source: string,
  layer: WeatherLayer,
  rows: WeatherCacheInsert[],
) {
  // Empty snapshot is authoritative — e.g. zero active NWS alerts must purge stale rows.
  if (!rows.length) {
    const { error: deleteError } = await admin
      .from('weather_cache')
      .delete()
      .eq('source', source)
      .eq('layer', layer)
    if (deleteError) throw deleteError
    return 0
  }

  const refreshedAt = rows[0].refreshed_at ?? new Date().toISOString()
  const { error: insertError } = await admin.from('weather_cache').insert(rows)
  if (insertError) throw insertError

  const { error: deleteError } = await admin
    .from('weather_cache')
    .delete()
    .eq('source', source)
    .eq('layer', layer)
    .lt('refreshed_at', refreshedAt)

  if (deleteError) throw deleteError
  return rows.length
}

export type WeatherSwathInsert = {
  event_date: string
  layer: WeatherLayer
  magnitude: number
  geometry: GeoJSON.Geometry
  source?: string
  refreshed_at?: string
}

export async function clearWeatherSwathsForDay(
  admin: SupabaseClient,
  eventDate: string,
  layer: WeatherLayer,
  source: string,
) {
  const { error } = await admin
    .from('weather_swaths')
    .delete()
    .eq('event_date', eventDate)
    .eq('layer', layer)
    .eq('source', source)
  if (error) throw error
}

export async function replaceWeatherSwathsForDay(
  admin: SupabaseClient,
  eventDate: string,
  layer: WeatherLayer,
  source: string,
  rows: WeatherSwathInsert[],
  // A single run may POST features in multiple batches (>MAX_FEATURES). Every batch
  // must share ONE refreshedAt so the delete-older step below removes only PRIOR
  // runs — not sibling batches from the same run. Callers that omit it get a
  // per-call timestamp (safe only for single-batch callers).
  refreshedAt: string = new Date().toISOString(),
  // Only delete the prior run's rows once the FINAL batch of this run has landed.
  // Earlier batches insert-only, so a mid-run failure leaves the previous good
  // swath intact rather than half-replacing it with a truncated one.
  deleteOlder = true,
) {
  if (!rows.length) return 0

  const payload = rows.map((row) => ({
    org_id: null,
    event_date: row.event_date,
    layer: row.layer,
    magnitude: row.magnitude,
    geometry: row.geometry,
    source: row.source ?? source,
    refreshed_at: refreshedAt,
  }))

  const { error: insertError } = await admin.from('weather_swaths').insert(payload)
  if (insertError) throw insertError

  if (!deleteOlder) return payload.length

  const { error: deleteError } = await admin
    .from('weather_swaths')
    .delete()
    .eq('event_date', eventDate)
    .eq('layer', layer)
    .eq('source', source)
    .lt('refreshed_at', refreshedAt)

  if (deleteError) throw deleteError
  return payload.length
}

export async function pruneWeatherRowsOlderThan(admin: SupabaseClient, windowDays: number) {
  const cutoff = cutoffDateIso(clampWindowDays(windowDays))
  await admin.from('weather_cache').delete().lt('event_date', cutoff)
  await admin.from('weather_swaths').delete().lt('event_date', cutoff)
}

export async function startWeatherRefreshRun(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('weather_refresh_runs')
    .insert({ status: 'ok', summary: {} })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function finishWeatherRefreshRun(
  admin: SupabaseClient,
  runId: string,
  status: 'ok' | 'partial' | 'failed',
  summary: Record<string, unknown>,
  errorMessage?: string,
) {
  await admin
    .from('weather_refresh_runs')
    .update({
      finished_at: new Date().toISOString(),
      status,
      summary,
      error: errorMessage ?? null,
    })
    .eq('id', runId)
}

export function maxIsoTimestamp(...values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().pop() ?? new Date().toISOString()
}
