import { NextResponse } from 'next/server'

import { verifyCronSecret } from '@/lib/cron-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { claimNextTile, completeTile, createTileUploadTarget, failTile } from '@/lib/lidar/ingest-queue'
import { LIDAR_BUILDINGS_BUCKET, lidarStoragePath } from '@/lib/lidar/sources'

export const dynamic = 'force-dynamic'

/**
 * POST /api/cron/lidar-ingest — the lidar tile queue for off-box workers (GitHub Actions).
 *
 * The runner does the heavy part (download a ~110 MB USGS tile, keep building points) and
 * never holds the Supabase service key: it claims a tile here, PUTs the encoded tile to the
 * one-time signed URL this returns, then reports back. Bearer CRON_SECRET, like every cron.
 *
 *   { action: 'claim' }                                  → { tile, upload } | { tile: null }
 *   { action: 'complete', id, totalPoints, buildingPoints, storedBytes }
 *   { action: 'fail', id, error }
 */
export async function POST(request: Request) {
  const authFailure = verifyCronSecret(request, 'lidar-ingest')
  if (authFailure) return authFailure

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const db = createServiceClient()

  if (body.action === 'claim') {
    const tile = await claimNextTile(db)
    if (!tile) return NextResponse.json({ tile: null })
    const upload = await createTileUploadTarget(db, tile)
    return NextResponse.json({ tile, upload })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  const { data: row } = await db.from('lidar_tiles').select('id, dataset, tile_name, status').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Unknown tile' }, { status: 404 })

  if (body.action === 'fail') {
    await failTile(db, row.id, typeof body.error === 'string' ? body.error : 'worker reported failure')
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'complete') {
    if (row.status !== 'processing') return NextResponse.json({ error: `Tile is ${row.status}, not processing` }, { status: 409 })
    const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
    const totalPoints = int(body.totalPoints), buildingPoints = int(body.buildingPoints), storedBytes = int(body.storedBytes)
    if (totalPoints == null || buildingPoints == null || storedBytes == null) {
      return NextResponse.json({ error: 'totalPoints, buildingPoints and storedBytes are required' }, { status: 400 })
    }
    // The path is ours, not the caller's — and the upload has to actually be there.
    const storagePath = lidarStoragePath(row.dataset, row.tile_name)
    const folder = storagePath.slice(0, storagePath.lastIndexOf('/'))
    const file = storagePath.slice(storagePath.lastIndexOf('/') + 1)
    const { data: listed } = await db.storage.from(LIDAR_BUILDINGS_BUCKET).list(folder, { search: file, limit: 1 })
    if (!listed?.some((o) => o.name === file)) {
      return NextResponse.json({ error: 'Upload not found in storage' }, { status: 409 })
    }
    await completeTile(db, row.id, { storagePath, totalPoints, buildingPoints, storedBytes })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
