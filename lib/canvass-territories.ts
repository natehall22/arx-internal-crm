import type { SupabaseClient } from '@supabase/supabase-js'
import {
  exteriorRingsFromGeoJSON,
  pointInAnyExteriorRing,
  type LngLatRing,
} from '@/lib/canvass-territory-geometry'

export type { LngLatRing }

export type TerritoryBoundaryRow = { boundary_geojson: unknown }

/** Serialized for the canvass map: one row per territory with rings for Google Maps polygons. */
export type AssignedTerritoryMapPayload = {
  id: string
  name: string
  color: string
  /** Exterior rings only (each ring is a closed [lng, lat] loop). */
  rings: LngLatRing[]
}

/**
 * Territories assigned to this user (directly or via team) for map overlays.
 * Reps see their work-area boundaries on the canvass map (Spotio / Sales Rabbit style).
 */
export async function fetchAssignedTerritoriesForMap(
  admin: SupabaseClient,
  orgId: string,
  userId: string
): Promise<AssignedTerritoryMapPayload[]> {
  const { data: links, error: linkErr } = await admin
    .from('canvass_territory_users')
    .select('territory_id')
    .eq('user_id', userId)

  const { data: me, error: meErr } = await admin
    .from('users')
    .select('team_id')
    .eq('id', userId)
    .maybeSingle()

  let territoryIds: string[] = []
  if (!linkErr && links?.length) {
    territoryIds.push(...links.map((l) => l.territory_id))
  }

  if (!meErr && me?.team_id) {
    const { data: teamLinks } = await admin
      .from('canvass_territory_teams')
      .select('territory_id')
      .eq('team_id', me.team_id)
    if (teamLinks?.length) {
      territoryIds.push(...teamLinks.map((l) => l.territory_id))
    }
  }

  territoryIds = Array.from(new Set(territoryIds))

  if (territoryIds.length === 0) {
    return []
  }

  const { data: territories, error: terrErr } = await admin
    .from('canvass_territories')
    .select('id, name, color, boundary_geojson')
    .eq('org_id', orgId)
    .in('id', territoryIds)
    .order('name')

  if (terrErr || !territories?.length) {
    return []
  }

  const out: AssignedTerritoryMapPayload[] = []
  for (const row of territories) {
    const rings = exteriorRingsFromGeoJSON(row.boundary_geojson)
    if (rings.length === 0) continue
    out.push({
      id: row.id,
      name: row.name || 'Area',
      color: typeof row.color === 'string' && row.color ? row.color : '#6366F1',
      rings,
    })
  }
  return out
}

/** Exterior rings from all territories assigned to a user or their team (union semantics). */
export async function fetchExteriorRingsForUser(
  admin: SupabaseClient,
  orgId: string,
  userId: string
): Promise<LngLatRing[]> {
  const { data: links, error: linkErr } = await admin
    .from('canvass_territory_users')
    .select('territory_id')
    .eq('user_id', userId)

  const { data: me, error: meErr } = await admin
    .from('users')
    .select('team_id')
    .eq('id', userId)
    .maybeSingle()

  let territoryIds: string[] = []
  if (!linkErr && links?.length) {
    territoryIds.push(...links.map((l) => l.territory_id))
  }

  if (!meErr && me?.team_id) {
    const { data: teamLinks } = await admin
      .from('canvass_territory_teams')
      .select('territory_id')
      .eq('team_id', me.team_id)
    if (teamLinks?.length) {
      territoryIds.push(...teamLinks.map((l) => l.territory_id))
    }
  }

  territoryIds = Array.from(new Set(territoryIds))

  if (territoryIds.length === 0) {
    return []
  }
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
