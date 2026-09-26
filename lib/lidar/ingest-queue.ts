/**
 * The lidar tile queue (`lidar_tiles`) — one implementation for both workers:
 * scripts/lidar-ingest.ts running with the service key, and the GitHub Actions runner,
 * which never holds the service key and reaches these through /api/cron/lidar-ingest.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { LIDAR_BUILDINGS_BUCKET, lidarStoragePath } from './sources'

export type LidarTileRow = {
  id: string
  dataset: string
  tile_name: string
  source_url: string
  attempts: number
  priority: number
}

export const MAX_TILE_ATTEMPTS = 3
/** A tile stuck in `processing` this long belongs to a worker that died — hand it out again. */
const STALE_PROCESSING_MS = 30 * 60 * 1000

/** Atomically take the highest-priority tile that still needs work. */
export async function claimNextTile(db: SupabaseClient): Promise<LidarTileRow | null> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString()
  const { data } = await db
    .from('lidar_tiles')
    .select('id, dataset, tile_name, source_url, attempts, priority, status, updated_at')
    .or(`status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${staleBefore})`)
    .lt('attempts', MAX_TILE_ATTEMPTS)
    .order('priority', { ascending: false })
    .limit(10)
  for (const row of data ?? []) {
    // Conditional update on the status we read: two workers can't both win the same tile.
    const { data: got } = await db
      .from('lidar_tiles')
      .update({ status: 'processing', attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', row.status)
      .eq('updated_at', row.updated_at)
      .select('id, dataset, tile_name, source_url, attempts, priority')
      .maybeSingle()
    if (got) return got as LidarTileRow
  }
  return null
}

/** A one-time URL the worker PUTs the encoded tile to (no size limit through our API). */
export async function createTileUploadTarget(db: SupabaseClient, tile: Pick<LidarTileRow, 'dataset' | 'tile_name'>) {
  const path = lidarStoragePath(tile.dataset, tile.tile_name)
  const { data, error } = await db.storage.from(LIDAR_BUILDINGS_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) throw error ?? new Error('Could not create lidar upload URL')
  return { path, signedUrl: data.signedUrl }
}

export async function completeTile(
  db: SupabaseClient,
  id: string,
  stats: { storagePath: string; totalPoints: number; buildingPoints: number; storedBytes: number }
) {
  const { error } = await db
    .from('lidar_tiles')
    .update({
      status: 'ready',
      storage_path: stats.storagePath,
      total_points: stats.totalPoints,
      building_points: stats.buildingPoints,
      stored_bytes: stats.storedBytes,
      error: null,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'processing')
  if (error) throw error
}

export async function failTile(db: SupabaseClient, id: string, message: string) {
  await db
    .from('lidar_tiles')
    .update({ status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', id)
}

/** USGS rockyweb throttles per connection (~300 KB/s); 8 parallel ranges ≈ 4× faster. */
export async function downloadWithRanges(url: string, parts = 8): Promise<Uint8Array> {
  const head = await fetch(url, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) throw new Error(`HEAD ${head.status}`)
  const out = new Uint8Array(size)
  const chunk = Math.ceil(size / parts)
  await Promise.all(
    Array.from({ length: parts }, async (_, i) => {
      const start = i * chunk
      const end = Math.min(size, start + chunk) - 1
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
          if (r.status !== 206) throw new Error(`range HTTP ${r.status}`)
          const buf = new Uint8Array(await r.arrayBuffer())
          if (buf.length !== end - start + 1) throw new Error('short range')
          out.set(buf, start)
          return
        } catch (e) {
          if (attempt >= 4) throw e
          await new Promise((res) => setTimeout(res, 2000 * attempt))
        }
      }
    })
  )
  return out
}
