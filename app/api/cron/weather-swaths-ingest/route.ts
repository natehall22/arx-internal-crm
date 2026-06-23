import { createServiceClient } from '@/lib/supabase/service'
import { weatherOverlayFeatureEnabled } from '@/lib/weather-footprint'
import {
  clearWeatherSwathsForDay,
  replaceWeatherSwathsForDay,
  type WeatherSwathInsert,
} from '@/lib/weather-storage'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type IngestBody = {
  eventDate?: string
  layer?: 'hail' | 'wind'
  source?: string
  clear?: boolean
  features?: Array<{
    magnitude?: number
    geometry?: GeoJSON.Geometry
  }>
}

// Abuse/bloat guards for the service-role insert (the ingest is reachable by any
// holder of CRON_SECRET, so never trust the payload shape).
const MAX_BODY_BYTES = 8 * 1024 * 1024 // 8 MB
const MAX_FEATURES = 1000
const MAX_VERTICES_PER_FEATURE = 6000
const MAX_MAGNITUDE = 8 // inches — sane ceiling for MRMS MESH hail

function countVertices(geometry: GeoJSON.Geometry): number {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.reduce((n, ring) => n + ring.length, 0)
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce(
      (n, poly) => n + poly.reduce((m, ring) => m + ring.length, 0),
      0,
    )
  }
  return 0
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

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Unable to read request body' }, { status: 400 })
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  let body: IngestBody
  try {
    body = JSON.parse(rawBody) as IngestBody
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

  if (body.clear === true) {
    if (features.length > 0) {
      return NextResponse.json({ error: 'clear cannot be combined with features' }, { status: 400 })
    }
    try {
      const admin = createServiceClient()
      await clearWeatherSwathsForDay(admin, eventDate, layer, source)
      return NextResponse.json({ ok: true, cleared: true, eventDate, layer, source })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[cron/weather-swaths-ingest] clear failed:', message)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  if (!features.length) {
    return NextResponse.json({ error: 'features array required' }, { status: 400 })
  }

  if (features.length > MAX_FEATURES) {
    return NextResponse.json(
      { error: `Too many features (max ${MAX_FEATURES})` },
      { status: 413 },
    )
  }

  const rows: WeatherSwathInsert[] = []
  let skipped = 0
  for (const feature of features) {
    const magnitude = Number(feature.magnitude)
    if (!Number.isFinite(magnitude) || magnitude <= 0 || magnitude > MAX_MAGNITUDE) {
      skipped += 1
      continue
    }
    if (!feature.geometry) {
      skipped += 1
      continue
    }
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
      skipped += 1
      continue
    }
    if (countVertices(feature.geometry) > MAX_VERTICES_PER_FEATURE) {
      skipped += 1
      continue
    }
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
    // Retention: drop swaths older than the 2-year insurance scope.
    const retentionCutoff = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10)
    await admin
      .from('weather_swaths')
      .delete()
      .eq('layer', layer)
      .eq('source', source)
      .lt('event_date', retentionCutoff)

    return NextResponse.json({ ok: true, upserted, skipped, eventDate, layer, source })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/weather-swaths-ingest]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
