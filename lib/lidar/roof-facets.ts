/**
 * Turn lidar roof planes into the section payload the roof-measure tool already loads
 * from /api/ai/detect-roof (same shape as SolarMaskFacetPayload), so lidar needs no new
 * UI: sections appear as editable drafts, and `facet_source: 'lidar_plane'` tells the
 * page their linear footage came from lidar.
 */
import type { LidarRoofResult } from './roof-planes'
import { ncFtToWgs84, US_SURVEY_FOOT_M, wgs84ToNcFt } from './nc-state-plane'

export const LIDAR_FACET_SOURCE = 'lidar_plane'
const M2_TO_SQFT = 10.7639
/** Sections smaller than this are dormer cheeks / noise the rep doesn't need to click through. */
const MIN_SECTION_SQFT = 40

export type LidarFacetPayload = {
  id: string
  vertices: [number, number][]
  lat_lng_vertices: { lat: number; lng: number }[]
  confidence: number
  estimated_sq_ft: number
  solar_segment_index: null
  suggested_pitch_degrees: number
  /** Downslope (lidar plane gradient) — the same convention as Solar's azimuthDegrees. */
  suggested_azimuth_degrees: number
  suggested_ground_area_sqft: number
  suggested_sloped_area_sqft: number
  plane_height_at_center_meters: number
  facet_source: typeof LIDAR_FACET_SOURCE
  /** Links the section back to its plane so the page can total lines for the sections kept. */
  lidar_plane_id: number
  lidar_eave_lf: number
  lidar_rake_lf: number
}

/** Plane-to-plane lines for the page: only lines between two sections still present count. */
export type LidarEdgePayload = { type: 'ridge' | 'hip' | 'valley'; lf: number; a: number; b: number }

export function lidarRoofToEdges(roof: LidarRoofResult): LidarEdgePayload[] {
  return roof.edges
    .filter((e): e is typeof e & { type: LidarEdgePayload['type'] } => e.type === 'ridge' || e.type === 'hip' || e.type === 'valley')
    .map((e) => ({ type: e.type, lf: Math.round(e.lengthM * 3.28084 * 10) / 10, a: e.planeA, b: e.planeB }))
}

/**
 * @param shiftM optional east/north offset (metres) that lines the outlines up with the
 *   satellite photo (lib/lidar/image-register.ts). Moves where sections are drawn only.
 */
export function lidarRoofToFacets(
  roof: LidarRoofResult,
  pinLat: number,
  pinLng: number,
  shiftM: { eastM: number; northM: number } = { eastM: 0, northM: 0 }
): LidarFacetPayload[] {
  const [px, py] = wgs84ToNcFt(pinLat, pinLng)
  const toLatLng = (x: number, y: number) =>
    ncFtToWgs84(px + (x + shiftM.eastM) / US_SURVEY_FOOT_M, py + (y + shiftM.northM) / US_SURVEY_FOOT_M)
  return roof.planes
    .filter((p) => p.flatAreaM2 * M2_TO_SQFT >= MIN_SECTION_SQFT && p.outline.length >= 3)
    .map((p) => {
      const cx = p.outline.reduce((s, q) => s + q.x, 0) / p.outline.length
      const cy = p.outline.reduce((s, q) => s + q.y, 0) / p.outline.length
      return {
        id: `lidar_${p.id}`,
        vertices: [],
        lat_lng_vertices: p.outline.map((q) => toLatLng(q.x, q.y)),
        confidence: 0.95,
        estimated_sq_ft: Math.round(p.flatAreaM2 * M2_TO_SQFT),
        solar_segment_index: null,
        suggested_pitch_degrees: Math.round(p.pitchDegrees * 10) / 10,
        suggested_azimuth_degrees: Math.round(p.drainAzimuthDegrees),
        suggested_ground_area_sqft: Math.round(p.flatAreaM2 * M2_TO_SQFT),
        suggested_sloped_area_sqft: Math.round(p.slopedAreaM2 * M2_TO_SQFT),
        plane_height_at_center_meters: Math.round((p.a * cx + p.b * cy + p.c) * 100) / 100,
        facet_source: LIDAR_FACET_SOURCE,
        lidar_plane_id: p.id,
        lidar_eave_lf: Math.round(p.eaveM * 3.28084 * 10) / 10,
        lidar_rake_lf: Math.round(p.rakeM * 3.28084 * 10) / 10,
      }
    })
}
