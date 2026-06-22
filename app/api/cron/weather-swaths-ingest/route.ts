import { createServiceClient } from '@/lib/supabase/service'
import { clampWindowDays, weatherOverlayFeatureEnabled } from '@/lib/weather-footprint'
import { replaceWeatherSwathsForDay, type WeatherSwathInsert } from '@/lib/weather-storage'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type IngestBody = {
  eventDate?: string
  layer?: 'hail' | 'wind'
  source?: string
  features?: Array<{
    magnitude?: number
    geometry?: GeoJSON.Geometry
  }>
}

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

export async function POST(request: NextRequest) {
  const authFailure = verifyCronSecret(request)
  if (authFailure) return authFailure

  if (!weatherOverlayFeatureEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'weather overlay flag off' })
  }

  let body: IngestBody
  try {
    body = (await request.json()) as IngestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const eventDate = String(body.eventDate || '').slice(0, 10)
  const layer = body.layer === 'wind' ? 'wind' : 'hail'
  const source = String(body.source || 'mrms_mesh')
  const features = Array.isArray(body.features) ? body.features : []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return NextResponse.json({ error: 'eventDate must be YYYY-MM-DD' }, { status: 400 })
  }

  if (!features.length) {
    return NextResponse.json({ error: 'features array required' }, { status: 400 })
  }

  const rows: WeatherSwathInsert[] = []
  for (const feature of features) {
    const magnitude = Number(feature.magnitude)
    if (!Number.isFinite(magnitude) || magnitude <= 0) continue
    if (!feature.geometry) continue
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue
    rows.push({
      event_date: eventDate,
      layer,
      magnitude,
      geometry: feature.geometry,
      source,
      refreshed_at: new Date().toISOString(),
    })
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'No valid swath features' }, { status: 400 })
  }

  try {
    const admin = createServiceClient()
    const upserted = await replaceWeatherSwathsForDay(admin, eventDate, layer, source, rows)
    await admin
      .from('weather_swaths')
      .delete()
      .eq('layer', layer)
      .eq('source', source)
      .lt('event_date', new Date(Date.now() - clampWindowDays(730) * 86400000).toISOString().slice(0, 10))

    return NextResponse.json({ ok: true, upserted, eventDate, layer, source })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/weather-swaths-ingest]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
