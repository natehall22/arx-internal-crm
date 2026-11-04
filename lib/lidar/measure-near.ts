/**
 * One lidar "measure the roof at this address" step, shared by the CRM measure tool
 * (`/api/ai/detect-roof`) and the public Instant Estimate. Tries the requested point
 * first, then Google's building centre when the pin is on the yard/street.
 * Server-only (service client reads the private `lidar-buildings` bucket).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineDistanceFeet } from '@/lib/roof-measure-geometry'
import { loadBuildingPointsNear } from './building-points'
import { measureRoofFromLidar, nearbyStructures, type LidarRoofResult, type NearbyStructure } from './roof-planes'

type LatLng = { lat: number; lng: number }

export type LidarRoofNearResult =
  | {
      status: 'ok'
      roof: LidarRoofResult
      /** The point the roof was measured around (lidar local origin). */
      pin: LatLng
      /** End of the lidar survey (YYYY-MM-DD) — anything built after is missing. */
      collectedEnd: string | null
      /** Possible detached garages/shops near the main building (sheds ignored). Advisory. */
      otherStructures: NearbyStructure[]
      tiles: string[]
    }
  | { status: 'not_ingested' | 'no_coverage' | 'no_building'; tiles: string[] }

const FT_PER_M = 3.28084

export async function measureLidarRoofNear(
  admin: SupabaseClient,
  requested: LatLng,
  anchor: LatLng | null,
  opts: { anchorFirst?: boolean } = {}
): Promise<LidarRoofNearResult> {
  const pins: LatLng[] = [requested]
  if (anchor) {
    const dM = haversineDistanceFeet(requested, anchor) / FT_PER_M
    // anchorFirst: the requested point is a non-rooftop geocode (street/interpolated), so
    // Google's building centre is the better first guess at the main house.
    if (dM > 5 && dM < 40) {
      if (opts.anchorFirst) pins.unshift(anchor)
      else pins.push(anchor)
    }
  }
  let lastTiles: string[] = []
  for (const pin of pins) {
    const lidar = await loadBuildingPointsNear(admin, pin.lat, pin.lng)
    lastTiles = lidar.tiles
    if (lidar.status !== 'ok') return { status: lidar.status, tiles: lidar.tiles }
    const roof = measureRoofFromLidar(lidar.points)
    if (roof) {
      return {
        status: 'ok',
        roof,
        pin,
        collectedEnd: lidar.collectedEnd,
        otherStructures: nearbyStructures(lidar.points),
        tiles: lidar.tiles,
      }
    }
  }
  return { status: 'no_building', tiles: lastTiles }
}
