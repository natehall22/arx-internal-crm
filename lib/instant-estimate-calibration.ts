/**
 * Instant Estimate calibration, learned from real jobs (view `instant_estimate_calibration`, fed by the nightly
 * accuracy cron — see lib/instant-estimate-accuracy.ts and docs/measure-tool/instant-estimate-accuracy.md).
 *
 * factor = median(trusted base squares / raw estimate base squares) for one measure_source, last 365 days.
 * It applies only with >= CALIBRATION_MIN_N checks and is clamped to [CALIBRATION_MIN_FACTOR, CALIBRATION_MAX_FACTOR],
 * so a handful of odd roofs can never swing a customer price far. Never throws — an estimate must not fail
 * because calibration could not be read. Kill switch: INSTANT_ESTIMATE_CALIBRATION=false.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const CALIBRATION_MIN_N = 8
export const CALIBRATION_MIN_FACTOR = 0.85
export const CALIBRATION_MAX_FACTOR = 1.15

export type InstantEstimateCalibration = Record<string, { factor: number; n: number }>

export function isInstantEstimateCalibrationEnabled(): boolean {
  return process.env.INSTANT_ESTIMATE_CALIBRATION !== 'false'
}

/** Pure: one view row → the factor to apply (1 when too few checks or not a usable number). */
export function calibrationFactorFromRow(n: unknown, medianRatio: unknown): number {
  const count = Number(n)
  const ratio = Number(medianRatio)
  if (!Number.isFinite(count) || count < CALIBRATION_MIN_N) return 1
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  return Math.min(CALIBRATION_MAX_FACTOR, Math.max(CALIBRATION_MIN_FACTOR, Math.round(ratio * 1000) / 1000))
}

/** Pure: factor for a measure source; 1 when the source has no applicable calibration. */
export function calibrationFactorFor(
  map: InstantEstimateCalibration | null | undefined,
  source: string | null | undefined
): number {
  if (!map || !source) return 1
  const entry = map[source]
  const f = entry?.factor
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? f : 1
}

export async function loadInstantEstimateCalibration(
  admin: SupabaseClient,
  orgId: string
): Promise<InstantEstimateCalibration> {
  if (!isInstantEstimateCalibrationEnabled() || !orgId) return {}
  try {
    const { data, error } = await admin
      .from('instant_estimate_calibration')
      .select('measure_source, n, median_ratio')
      .eq('org_id', orgId)
    if (error || !Array.isArray(data)) return {}
    const out: InstantEstimateCalibration = {}
    for (const row of data as { measure_source: string | null; n: unknown; median_ratio: unknown }[]) {
      if (!row.measure_source) continue
      const n = Number(row.n) || 0
      out[row.measure_source] = { factor: calibrationFactorFromRow(n, row.median_ratio), n }
    }
    return out
  } catch {
    return {}
  }
}
