import { ridgeHipCapOrderSummary } from '@/lib/hip-ridge-cap-squares'
import { calculateRoofWaste, type RoofWasteEstimate } from '@/lib/roof-waste-model'
export {
  BUNDLES_PER_SQUARE,
  CAP_LF_PER_BUNDLE,
  DEFAULT_CAP_LF_PER_SQUARE,
} from '@/lib/roof-shingle-constants'

import { BUNDLES_PER_SQUARE, CAP_LF_PER_BUNDLE, STARTER_LF_PER_BUNDLE } from '@/lib/roof-shingle-constants'

export type RoofFieldOrderEstimate = {
  baseSquares: number
  wastePercent: number
  wasteSquares: number
  totalSquaresWithWaste: number
  fieldBundles: number
  recommendedOrderSquares: number
}

export function roofFieldOrderFromMeasurement(input: {
  total_squares: number
  suggested_waste_percent: number
  waste_squares?: number
}): RoofFieldOrderEstimate {
  const baseSquares = Math.max(0, input.total_squares)
  const wastePercent = Math.max(0, input.suggested_waste_percent)
  const wasteSquares =
    input.waste_squares != null && input.waste_squares > 0
      ? Math.round(input.waste_squares * 100) / 100
      : baseSquares * (wastePercent / 100)
  const totalSquaresWithWaste = baseSquares + wasteSquares
  const fieldBundles = Math.ceil(totalSquaresWithWaste * BUNDLES_PER_SQUARE)
  const recommendedOrderSquares = Math.ceil(fieldBundles / BUNDLES_PER_SQUARE)

  return {
    baseSquares,
    wastePercent,
    wasteSquares,
    totalSquaresWithWaste,
    fieldBundles,
    recommendedOrderSquares,
  }
}

export function roofCapBundlesFromLf(
  ridges_lf: number,
  hips_lf: number,
  lfPerBundle: number = CAP_LF_PER_BUNDLE
) {
  const ridgeCapBundles = ridges_lf > 0 && lfPerBundle > 0 ? Math.ceil(ridges_lf / lfPerBundle) : 0
  const hipCapBundles = hips_lf > 0 && lfPerBundle > 0 ? Math.ceil(hips_lf / lfPerBundle) : 0
  return {
    ridgeCapBundles,
    hipCapBundles,
    totalCapBundles: ridgeCapBundles + hipCapBundles,
  }
}

export function roofStarterBundlesFromLf(
  eaves_lf: number,
  rakes_lf: number,
  lfPerBundle: number = STARTER_LF_PER_BUNDLE
) {
  const combinedLf = Math.max(0, eaves_lf) + Math.max(0, rakes_lf)
  const bundles = combinedLf > 0 && lfPerBundle > 0 ? Math.ceil(combinedLf / lfPerBundle) : 0
  return { combinedLf, bundles, lfPerBundle }
}

export function roofWasteAndOrder(input: {
  total_squares: number
  facet_count: number
  valleys_lf: number
  hips_lf: number
  ridges_lf: number
  avg_pitch_multiplier: number
  avg_pitch_degrees?: number
}) {
  const waste: RoofWasteEstimate = calculateRoofWaste({
    baseSquares: input.total_squares,
    facetCount: input.facet_count,
    valleys_lf: input.valleys_lf,
    hips_lf: input.hips_lf,
    ridges_lf: input.ridges_lf,
    avgPitchMultiplier: input.avg_pitch_multiplier,
    avgPitchDegrees: input.avg_pitch_degrees,
  })
  const field = roofFieldOrderFromMeasurement({
    total_squares: input.total_squares,
    suggested_waste_percent: waste.wastePercent,
    waste_squares: waste.wasteSquares,
  })
  const caps = ridgeHipCapOrderSummary({
    ridges_lf: input.ridges_lf,
    hips_lf: input.hips_lf,
  })
  return { waste, field, caps }
}
