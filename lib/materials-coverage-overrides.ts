import {
  CAP_LF_PER_BUNDLE,
  ICE_WATER_LF_PER_ROLL,
  ICE_WATER_SQFT_PER_ROLL,
  RIDGE_VENT_END_SETBACK_FT,
  RIDGE_VENT_LF_PER_PIECE,
  STARTER_LF_PER_BUNDLE,
  UNDERLAYMENT_SQ_PER_ROLL,
} from '@/lib/roof-shingle-constants'

/** Nullable org-level coverage overrides (NULL column = use lib defaults). */
export type OrgMaterialsCoverageRow = {
  starter_lf_per_bundle?: number | null
  cap_lf_per_bundle?: number | null
  underlayment_sq_per_roll?: number | null
  ridge_vent_lf_per_piece?: number | null
  ridge_vent_end_setback_ft?: number | null
  ice_water_lf_per_roll?: number | null
}

export type MaterialsCoverageOverrides = {
  starterLfPerBundle: number
  capLfPerBundle: number
  capLfPerSquare: number
  underlaymentSqPerRoll: number
  ridgeVentLfPerPiece: number
  ridgeVentEndSetbackFt: number
  iceWaterLfPerRoll: number
  iceWaterSqftPerRoll: number
}

function positiveOrDefault(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(Number(value))) return fallback
  const n = Number(value)
  return n > 0 ? n : fallback
}

export function resolveMaterialsCoverageOverrides(
  row?: OrgMaterialsCoverageRow | null
): MaterialsCoverageOverrides {
  const capLfPerBundle = positiveOrDefault(row?.cap_lf_per_bundle, CAP_LF_PER_BUNDLE)
  return {
    starterLfPerBundle: positiveOrDefault(row?.starter_lf_per_bundle, STARTER_LF_PER_BUNDLE),
    capLfPerBundle,
    capLfPerSquare: capLfPerBundle * 4,
    underlaymentSqPerRoll: positiveOrDefault(row?.underlayment_sq_per_roll, UNDERLAYMENT_SQ_PER_ROLL),
    ridgeVentLfPerPiece: positiveOrDefault(row?.ridge_vent_lf_per_piece, RIDGE_VENT_LF_PER_PIECE),
    ridgeVentEndSetbackFt: positiveOrDefault(row?.ridge_vent_end_setback_ft, RIDGE_VENT_END_SETBACK_FT),
    iceWaterLfPerRoll: positiveOrDefault(row?.ice_water_lf_per_roll, ICE_WATER_LF_PER_ROLL),
    iceWaterSqftPerRoll: ICE_WATER_SQFT_PER_ROLL,
  }
}
