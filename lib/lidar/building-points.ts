/**
 * Load cached lidar building points around a property (see scripts/lidar-ingest.ts),
 * as local metres with the pin at the origin — the input to measureRoofFromLidar.
 * Server-only: reads the private `lidar-buildings` bucket with the service client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { decodeTilePoints, type TilePoints } from './tile-store'
import { US_SURVEY_FOOT_M, wgs84ToNcFt } from './nc-state-plane'
import { LIDAR_BUILDINGS_BUCKET } from './sources'
import type { LocalPoint } from './roof-planes'

export type BuildingPointsResult =
  | { status: 'ok'; points: LocalPoint[]; collectedEnd: string | null; tiles: string[] }
  | { status: 'not_ingested' | 'no_coverage'; points: []; collectedEnd: null; tiles: string[] }

const DEG_LAT_PER_M = 1 / 111_320

/**
 * Small per-instance cache of decoded tiles (~2–3 MB each). A measurement often reads the
 * same tiles twice (address point, then Google's building centre), and nearby estimates hit
 * the same tiles — this keeps Supabase egress and latency down. Tiles never change once ready.
 */
const TILE_CACHE_MAX = 6
const tileCache = new Map<string, TilePoints['xyz']>()
async function tileXyz(admin: SupabaseClient, path: string, id: string) {
  const hit = tileCache.get(path)
  if (hit) {
    tileCache.delete(path)
    tileCache.set(path, hit) // LRU bump
    return hit
  }
  const { data: blob, error: dlErr } = await admin.storage.from(LIDAR_BUILDINGS_BUCKET).download(path)
  if (dlErr || !blob) throw dlErr ?? new Error(`lidar tile ${id} missing from storage`)
  const { xyz } = decodeTilePoints(new Uint8Array(await blob.arrayBuffer()))
  tileCache.set(path, xyz)
  while (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value as string)
  return xyz
}

export async function loadBuildingPointsNear(
  admin: SupabaseClient,
  lat: number,
  lng: number,
  radiusM = 35
): Promise<BuildingPointsResult> {
  const dLat = radiusM * DEG_LAT_PER_M
  const dLng = dLat / Math.cos((lat * Math.PI) / 180)
  const { data: tiles, error } = await admin
    .from('lidar_tiles')
    .select('id, status, storage_path, collected_end')
    .lte('min_lat', lat + dLat)
    .gte('max_lat', lat - dLat)
    .lte('min_lng', lng + dLng)
    .gte('max_lng', lng - dLng)
  if (error) throw error
  const all = tiles ?? []
  if (all.length === 0) return { status: 'no_coverage', points: [], collectedEnd: null, tiles: [] }
  // Every tile touching the search box must be ready, or a house on a tile seam comes back half-measured.
  if (all.some((t) => t.status !== 'ready' || !t.storage_path)) {
    return { status: 'not_ingested', points: [], collectedEnd: null, tiles: all.map((t) => t.id) }
  }

  const [px, py] = wgs84ToNcFt(lat, lng)
  const rFt = radiusM / US_SURVEY_FOOT_M
  const points: LocalPoint[] = []
  for (const t of all) {
    const xyz = await tileXyz(admin, t.storage_path!, t.id)
    for (let i = 0; i < xyz.length; i += 3) {
      const dx = xyz[i] - px, dy = xyz[i + 1] - py
      if (Math.abs(dx) > rFt || Math.abs(dy) > rFt) continue
      points.push({ x: dx * US_SURVEY_FOOT_M, y: dy * US_SURVEY_FOOT_M, z: xyz[i + 2] * US_SURVEY_FOOT_M })
    }
  }
  const collectedEnd = all.map((t) => t.collected_end).filter(Boolean).sort().pop() ?? null
  return { status: 'ok', points, collectedEnd, tiles: all.map((t) => t.id) }
}
