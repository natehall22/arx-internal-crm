/**
 * Load cached lidar building points around a property (see scripts/lidar-ingest.ts),
 * as local metres with the pin at the origin — the input to measureRoofFromLidar.
 * Server-only: reads the private `lidar-buildings` bucket with the service client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { decodeTilePoints } from './tile-store'
import { US_SURVEY_FOOT_M, wgs84ToNcFt } from './nc-state-plane'
import { LIDAR_BUILDINGS_BUCKET } from './sources'
import type { LocalPoint } from './roof-planes'

export type BuildingPointsResult =
  | { status: 'ok'; points: LocalPoint[]; collectedEnd: string | null; tiles: string[] }
  | { status: 'not_ingested' | 'no_coverage'; points: []; collectedEnd: null; tiles: string[] }

const DEG_LAT_PER_M = 1 / 111_320

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
    const { data: blob, error: dlErr } = await admin.storage.from(LIDAR_BUILDINGS_BUCKET).download(t.storage_path!)
    if (dlErr || !blob) throw dlErr ?? new Error(`lidar tile ${t.id} missing from storage`)
    const { xyz } = decodeTilePoints(new Uint8Array(await blob.arrayBuffer()))
    for (let i = 0; i < xyz.length; i += 3) {
      const dx = xyz[i] - px, dy = xyz[i + 1] - py
      if (Math.abs(dx) > rFt || Math.abs(dy) > rFt) continue
      points.push({ x: dx * US_SURVEY_FOOT_M, y: dy * US_SURVEY_FOOT_M, z: xyz[i + 2] * US_SURVEY_FOOT_M })
    }
  }
  const collectedEnd = all.map((t) => t.collected_end).filter(Boolean).sort().pop() ?? null
  return { status: 'ok', points, collectedEnd, tiles: all.map((t) => t.id) }
}
