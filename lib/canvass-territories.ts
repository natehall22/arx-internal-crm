import type { SupabaseClient } from '@supabase/supabase-js'
import {
  exteriorRingsFromGeoJSON,
  pointInAnyExteriorRing,
  type LngLatRing,
} from '@/lib/canvass-territory-geometry'

export type TerritoryBoundaryRow = { boundary_geojson: unknown }

/** Exterior rings from all territories assigned to a user (union semantics). */
export async function fetchExteriorRingsForUser(
  admin: SupabaseClient,
  orgId: string,
  userId: string
): Promise<LngLatRing[]> {
  const { data: links, error: linkErr } = await admin
    .from('canvass_territory_users')
    .select('territory_id')
    .eq('user_id', userId)

  if (linkErr || !links?.length) {
    return []
  }

  const territoryIds = links.map((l) => l.territory_id)
  const { data: territories, error: terrErr } = await admin
    .from('canvass_territories')
    .select('boundary_geojson')
    .eq('org_id', orgId)
    .in('id', territoryIds)

  if (terrErr || !territories?.length) {
    return []
  }

  const rings: LngLatRing[] = []
  for (const row of territories) {
    rings.push(...exteriorRingsFromGeoJSON(row.boundary_geojson))
  }
  return rings
}

export function leadLngLatInRings(
  lng: number,
  lat: number,
  rings: LngLatRing[]
): boolean {
  return pointInAnyExteriorRing(lng, lat, rings)
}

/** For viewport: over-fetch then filter (MVP; dense metros may truncate). */
export function filterLeadsByTerritoryRings<T extends { lng: unknown; lat: unknown }>(
  leads: T[],
  rings: LngLatRing[],
  maxResults: number
): T[] {
  if (rings.length === 0) return []
  const out: T[] = []
  for (const lead of leads) {
    const lng = parseFloat(String(lead.lng))
    const lat = parseFloat(String(lead.lat))
    if (Number.isNaN(lng) || Number.isNaN(lat)) continue
    if (leadLngLatInRings(lng, lat, rings)) {
      out.push(lead)
      if (out.length >= maxResults) break
    }
  }
  return out
}
