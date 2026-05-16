/**
 * LiDAR measurement ingestion — shared logic for the iOS companion app.
 *
 * The ARX iOS app uses ARKit + LiDAR to capture precise on-site measurements
 * of individual elevations, windows, and doors. This module validates and merges
 * that payload into the existing job_measure_* tables.
 *
 * iOS integration notes
 * ─────────────────────
 * POST to:
 *   /api/opportunities/:id/measure/lidar   (sales / opportunity context)
 *   /api/ops/jobs/:id/measure/lidar        (production / job context)
 *
 * Authentication: supply the user's Supabase JWT in the Authorization header.
 *   Authorization: Bearer <supabase_access_token>
 *
 * The iOS app should call these endpoints after the rep finishes an ARKit
 * measurement session. The server merges the LiDAR data into any existing
 * elevation records or creates new ones; the web form then shows the
 * pre-filled values for ops review.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Payload types (match these in the iOS Swift structs) ─────────────────────

export type LidarOpeningMeasurement = {
  /** Matches job_measure_openings.opening_type */
  opening_type: 'window' | 'door' | 'garage_door' | 'other'
  /** Optional human label, e.g. "Master bedroom window" */
  label?: string
  quantity: number
  /** Width in feet — from ARKit world measurement */
  width_ft: number
  /** Height in feet — from ARKit world measurement */
  height_ft: number
  /** ARKit confidence 0–1 */
  lidar_confidence?: number
}

export type LidarElevationMeasurement = {
  /** Matches the elevation_name in the form — "Front", "Right", "Rear", "Left" or custom */
  elevation_name: string
  /**
   * Overall wall width in feet. ARKit can measure this if the rep walks the
   * full length with the camera tracking the baseline.
   */
  wall_width_ft?: number
  /** Wall height floor-to-eave in feet */
  wall_height_ft?: number
  /** Gable triangle width at base */
  gable_width_ft?: number
  /** Gable triangle height */
  gable_height_ft?: number
  /** Soffit depth (eave overhang) — LiDAR accurate from ground */
  soffit_depth_ft?: number
  /** Soffit run length — typically equals fascia / gutter lf */
  soffit_length_ft?: number
  fascia_lf?: number
  gutter_lf?: number
  starter_strip_lf?: number
  j_channel_lf?: number
  inside_corners?: number
  outside_corners?: number
  openings?: LidarOpeningMeasurement[]
  /** ARKit session confidence for this elevation overall */
  lidar_confidence?: number
  /** ISO 8601 timestamp of the ARKit session */
  captured_at?: string
}

export type LidarMeasurePayload = {
  /**
   * If supplied, the server will find (or create) the elevation with this name
   * and merge the LiDAR data into it. If omitted, all elevations in the array
   * are processed in order.
   */
  elevations: LidarElevationMeasurement[]
  /** Device model string from UIDevice.current.model, e.g. "iPhone 15 Pro" */
  device_model?: string
  /** ARKit session identifier for debugging */
  arkit_session_id?: string
}

// ─── Ingestion logic ──────────────────────────────────────────────────────────

function clampNum(value: number | undefined, min = 0, max = 9999): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(min, Math.min(max, value))
}

function clampInt(value: number | undefined): number | undefined {
  const n = clampNum(value)
  return n !== undefined ? Math.round(n) : undefined
}

/**
 * Merges one LiDAR elevation payload into an existing elevation row (or creates
 * a new one). Only fields present in the payload are written — existing values
 * are not overwritten with undefined/null.
 */
async function mergeElevation(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    reportId: string
    opportunityId: string
    jobId: string | null
    elevation: LidarElevationMeasurement
    sortOrder: number
  }
) {
  const { orgId, reportId, opportunityId, jobId, elevation, sortOrder } = opts

  // Find existing elevation by name (case-insensitive)
  const { data: existing } = await supabase
    .from('job_measure_elevations')
    .select('id')
    .eq('org_id', orgId)
    .eq('report_id', reportId)
    .ilike('elevation_name', elevation.elevation_name.trim())
    .maybeSingle()

  const elevationId = existing?.id ?? crypto.randomUUID()

  // Build the upsert payload — only include defined values so we don't clobber
  // fields that ops already filled in manually
  const payload: Record<string, unknown> = {
    id: elevationId,
    org_id: orgId,
    report_id: reportId,
    opportunity_id: opportunityId,
    job_id: jobId,
    elevation_name: elevation.elevation_name.trim().slice(0, 80),
    sort_order: sortOrder,
  }

  const num = (v?: number) => clampNum(v)
  const int = (v?: number) => clampInt(v)

  if (num(elevation.wall_width_ft)    !== undefined) payload.wall_width_ft    = num(elevation.wall_width_ft)
  if (num(elevation.wall_height_ft)   !== undefined) payload.wall_height_ft   = num(elevation.wall_height_ft)
  if (num(elevation.gable_width_ft)   !== undefined) payload.gable_width_ft   = num(elevation.gable_width_ft)
  if (num(elevation.gable_height_ft)  !== undefined) payload.gable_height_ft  = num(elevation.gable_height_ft)
  if (num(elevation.soffit_depth_ft)  !== undefined) payload.soffit_depth_ft  = num(elevation.soffit_depth_ft)
  if (num(elevation.soffit_length_ft) !== undefined) payload.soffit_length_ft = num(elevation.soffit_length_ft)
  if (num(elevation.fascia_lf)        !== undefined) payload.fascia_lf        = num(elevation.fascia_lf)
  if (num(elevation.gutter_lf)        !== undefined) payload.gutter_lf        = num(elevation.gutter_lf)
  if (num(elevation.starter_strip_lf) !== undefined) payload.starter_strip_lf = num(elevation.starter_strip_lf)
  if (num(elevation.j_channel_lf)     !== undefined) payload.j_channel_lf     = num(elevation.j_channel_lf)
  if (int(elevation.inside_corners)   !== undefined) payload.inside_corners   = int(elevation.inside_corners)
  if (int(elevation.outside_corners)  !== undefined) payload.outside_corners  = int(elevation.outside_corners)

  const { data: savedElevation, error } = await supabase
    .from('job_measure_elevations')
    .upsert(payload, { onConflict: 'id' })
    .select('id')
    .single()

  if (error) throw error

  // Upsert openings if provided — replace the entire set for this elevation
  if (Array.isArray(elevation.openings) && elevation.openings.length > 0) {
    // Remove old openings
    await supabase
      .from('job_measure_openings')
      .delete()
      .eq('org_id', orgId)
      .eq('elevation_id', savedElevation.id)

    const openingInserts = elevation.openings.map((o) => ({
      id: crypto.randomUUID(),
      org_id: orgId,
      report_id: reportId,
      elevation_id: savedElevation.id,
      opportunity_id: opportunityId,
      job_id: jobId,
      opening_type: ['window', 'door', 'garage_door', 'other'].includes(o.opening_type)
        ? o.opening_type
        : 'window',
      label: typeof o.label === 'string' ? o.label.slice(0, 80) : null,
      quantity: Math.max(1, Math.round(Number(o.quantity) || 1)),
      width_ft: clampNum(o.width_ft) ?? 0,
      height_ft: clampNum(o.height_ft) ?? 0,
    }))

    const { error: openingError } = await supabase
      .from('job_measure_openings')
      .insert(openingInserts)

    if (openingError) throw openingError
  }

  return savedElevation.id
}

export async function ingestLidarPayload(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    opportunityId: string
    jobId: string | null
    userId: string
    payload: LidarMeasurePayload
  }
) {
  const { orgId, opportunityId, jobId, userId, payload } = opts

  // Ensure a measure report exists
  let { data: report } = await supabase
    .from('job_measure_reports')
    .select('id')
    .eq('org_id', orgId)
    .eq('opportunity_id', opportunityId)
    .maybeSingle()

  if (!report) {
    const { data: created, error } = await supabase
      .from('job_measure_reports')
      .insert({
        org_id: orgId,
        opportunity_id: opportunityId,
        job_id: jobId,
        measure_kind: 'siding',
        status: 'draft',
        report_title: 'ARX Exterior Measure Report',
        waste_percent: 10,
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .single()

    if (error) throw error
    report = created
  }

  // Update updated_by
  await supabase
    .from('job_measure_reports')
    .update({ updated_by: userId })
    .eq('id', report.id)

  const elevationIds: string[] = []
  for (let i = 0; i < payload.elevations.length; i++) {
    const id = await mergeElevation(supabase, {
      orgId,
      reportId: report.id,
      opportunityId,
      jobId,
      elevation: payload.elevations[i],
      sortOrder: i,
    })
    elevationIds.push(id)
  }

  return { reportId: report.id, elevationIds }
}
