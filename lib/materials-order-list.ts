/**
 * Full materials order list for a roofing job, derived from the sold scope
 * (proposal squares incl. waste) + roof measurement linear footages.
 *
 * Pure and side-effect free so it can be unit tested and reused
 * (ops job page, job packet, future print sheet).
 */
import {
  BUNDLES_PER_SQUARE,
  DRIP_EDGE_LF_PER_STICK,
  STEP_FLASHING_PIECES_PER_LF,
} from '@/lib/roof-shingle-constants'
import type { MaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import { resolveMaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import { hipRidgeCapFromLinearFt, ridgeHipCapOrderSummary } from '@/lib/hip-ridge-cap-squares'
import { roofCapBundlesFromLf } from '@/lib/roof-material-order'
import { starterFromLinearFt } from '@/lib/starter-strip'

export type MaterialsOrderItemStatus = 'ready' | 'confirm' | 'manual'

export type MaterialsOrderItem = {
  key: string
  label: string
  /** Primary quantity, e.g. "20 sq · 58 bundles". Null for manual rows. */
  qty: string | null
  /** Where the number came from, e.g. "eaves 120 LF + rakes 48 LF". */
  detail: string | null
  status: MaterialsOrderItemStatus
  /** Shown when status is 'confirm' or 'manual'. */
  note: string | null
}

export type MaterialsOrderLinear = {
  ridges_lf: number | null
  valleys_lf: number | null
  hips_lf: number | null
  eaves_lf: number | null
  rakes_lf: number | null
  flashing_lf: number | null
  step_flashing_lf: number | null
  wall_flashing_lf: number | null
  drip_edge_lf?: number | null
}

export type MaterialsOrderInput = {
  /** Sold total squares including waste (the "19.1 sq total" number). */
  totalSquaresWithWaste: number | null
  linear: MaterialsOrderLinear | null
  /** Count of distinct ridge runs when known (for vent end setbacks). */
  ridgeSegmentCount?: number | null
  /** Facet area at 1/12 pitch or lower, from the roof measure. */
  lowSlopeAreaSqft?: number | null
  lowSlopeFacetCount?: number | null
  /** From roof_measurements.penetration_count when captured. */
  penetrationCount?: number | null
  /** Org-level coverage overrides; omitted = lib defaults. */
  coverageOverrides?: MaterialsCoverageOverrides | null
}

function pos(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(Number(value))) return 0
  const n = Number(value)
  return n > 0 ? n : 0
}

function fmtLf(n: number): string {
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)
}

/** ARX materials order list applies a small starter safety cushion. */
export const MATERIALS_ORDER_STARTER_CUSHION_PERCENT = 5

export function buildMaterialsOrderList(input: MaterialsOrderInput): MaterialsOrderItem[] {
  const items: MaterialsOrderItem[] = []
  const linear = input.linear
  const totalSq = pos(input.totalSquaresWithWaste)
  const cov = input.coverageOverrides ?? resolveMaterialsCoverageOverrides(null)

  // 1. Field shingles
  if (totalSq > 0) {
    const bundles = Math.ceil(totalSq * BUNDLES_PER_SQUARE)
    const orderSq = Math.round((bundles / BUNDLES_PER_SQUARE) * 100) / 100
    items.push({
      key: 'field_shingles',
      label: 'Field shingles',
      qty: `${orderSq.toFixed(1)} sq · ${bundles} bundles`,
      detail: `${totalSq.toFixed(1)} sq sold total (waste included), rounded up to full bundles`,
      status: 'ready',
      note: null,
    })
  } else {
    items.push({
      key: 'field_shingles',
      label: 'Field shingles',
      qty: null,
      detail: null,
      status: 'confirm',
      note: 'No sold squares on file — confirm total before ordering.',
    })
  }

  // 2. Starter (eaves + rakes)
  const starter = linear
    ? starterFromLinearFt({
        eaves_lf: linear.eaves_lf,
        rakes_lf: linear.rakes_lf,
        lfPerBundle: cov.starterLfPerBundle,
        cushionPercent: MATERIALS_ORDER_STARTER_CUSHION_PERCENT,
      })
    : null
  if (starter) {
    const cushionNote =
      MATERIALS_ORDER_STARTER_CUSHION_PERCENT > 0
        ? ` incl. ${MATERIALS_ORDER_STARTER_CUSHION_PERCENT}% safety cushion`
        : ''
    items.push({
      key: 'starter',
      label: 'Starter strip',
      qty: `${starter.bundles} bundle${starter.bundles === 1 ? '' : 's'}`,
      detail: `eaves ${fmtLf(starter.eaves_lf)} LF + rakes ${fmtLf(starter.rakes_lf)} LF = ${fmtLf(starter.combinedLf)} LF @ ${starter.lfPerBundle} LF/bundle${cushionNote}`,
      status: 'ready',
      note: null,
    })
  }

  // 3. Hip & ridge cap
  const cap = linear
    ? hipRidgeCapFromLinearFt({
        ridges_lf: linear.ridges_lf,
        hips_lf: linear.hips_lf,
        lfPerSquare: cov.capLfPerSquare,
      })
    : null
  if (cap && linear) {
    const capSummary = ridgeHipCapOrderSummary({
      ridges_lf: linear.ridges_lf,
      hips_lf: linear.hips_lf,
      lfPerSquare: cov.capLfPerSquare,
    })
    const bundles = capSummary
      ? roofCapBundlesFromLf(capSummary.ridges_lf, capSummary.hips_lf, cov.capLfPerBundle).totalCapBundles
      : null
    items.push({
      key: 'hip_ridge_cap',
      label: 'Hip & ridge cap',
      qty: bundles != null ? `${cap.capSq.toFixed(2)} sq · ${bundles} bundles` : `${cap.capSq.toFixed(2)} sq`,
      detail: `ridge ${fmtLf(pos(linear.ridges_lf))} LF + hip ${fmtLf(pos(linear.hips_lf))} LF = ${cap.combinedLf.toFixed(1)} LF`,
      status: 'ready',
      note: null,
    })
  }

  // 4. Ridge vent — stops short of each ridge end
  const ridgesLf = pos(linear?.ridges_lf)
  if (ridgesLf > 0) {
    const rawSegmentCount =
      input.ridgeSegmentCount != null && input.ridgeSegmentCount > 0
        ? Math.floor(input.ridgeSegmentCount)
        : 1
    const segmentCount =
      rawSegmentCount * 2 * cov.ridgeVentEndSetbackFt < ridgesLf / 2 ? rawSegmentCount : 1
    const setback = segmentCount * 2 * cov.ridgeVentEndSetbackFt
    const ventLf = Math.max(0, ridgesLf - setback)
    const pieces = ventLf > 0 ? Math.ceil(ventLf / cov.ridgeVentLfPerPiece) : 0
    const segmentNote =
      input.ridgeSegmentCount == null || input.ridgeSegmentCount <= 0
        ? ` (assumes 1 ridge run — subtract ${2 * cov.ridgeVentEndSetbackFt} LF per extra run)`
        : ''
    items.push({
      key: 'ridge_vent',
      label: 'Ridge vent',
      qty: pieces > 0 ? `${fmtLf(ventLf)} LF · ${pieces} pieces` : '0 LF',
      detail: `ridge ${fmtLf(ridgesLf)} LF − ${cov.ridgeVentEndSetbackFt}' each end${segmentNote} @ ${cov.ridgeVentLfPerPiece}' pieces`,
      status: 'ready',
      note: null,
    })
  }

  // 5. Underlayment (synthetic)
  if (totalSq > 0) {
    const rolls = Math.ceil(totalSq / cov.underlaymentSqPerRoll)
    items.push({
      key: 'underlayment',
      label: 'Underlayment (synthetic)',
      qty: `${rolls} roll${rolls === 1 ? '' : 's'}`,
      detail: `${totalSq.toFixed(1)} sq @ ${cov.underlaymentSqPerRoll} sq/roll`,
      status: 'ready',
      note: null,
    })
  }

  // 6. Ice & water — only low-slope (≤ 1/12) auto-computes; valleys are confirm-only
  const lowSlopeSqft = pos(input.lowSlopeAreaSqft)
  const valleysLf = pos(linear?.valleys_lf)
  if (lowSlopeSqft > 0) {
    const rolls = Math.ceil(lowSlopeSqft / cov.iceWaterSqftPerRoll)
    const facetPart =
      input.lowSlopeFacetCount != null && input.lowSlopeFacetCount > 0
        ? `${input.lowSlopeFacetCount} low-slope section${input.lowSlopeFacetCount === 1 ? '' : 's'} (≤1/12), `
        : ''
    items.push({
      key: 'ice_water_low_slope',
      label: 'Ice & water shield (low slope)',
      qty: `${rolls} roll${rolls === 1 ? '' : 's'}`,
      detail: `${facetPart}${Math.round(lowSlopeSqft)} sq ft @ ${cov.iceWaterSqftPerRoll} sq ft/roll`,
      status: 'ready',
      note: null,
    })
  }
  if (valleysLf > 0) {
    const rolls = Math.ceil(valleysLf / cov.iceWaterLfPerRoll)
    items.push({
      key: 'ice_water_valleys',
      label: 'Ice & water shield (valleys)',
      qty: `${rolls} roll${rolls === 1 ? '' : 's'} if needed`,
      detail: `valleys ${fmtLf(valleysLf)} LF @ ${cov.iceWaterLfPerRoll} LF/roll`,
      status: 'confirm',
      note: 'ARX runs valley ice & water only on complex valleys — confirm before ordering.',
    })
  }

  // 7. Drip edge (10 ft sticks) — prefer measured drip_edge_lf, else eaves + rakes
  const dripLf =
    pos(linear?.drip_edge_lf) > 0
      ? pos(linear?.drip_edge_lf)
      : pos(linear?.eaves_lf) + pos(linear?.rakes_lf)
  if (dripLf > 0) {
    const sticks = Math.ceil(dripLf / DRIP_EDGE_LF_PER_STICK)
    items.push({
      key: 'drip_edge',
      label: 'Drip edge',
      qty: `${sticks} sticks if needed`,
      detail: `${fmtLf(dripLf)} LF @ ${DRIP_EDGE_LF_PER_STICK}' sticks (eaves + rakes)`,
      status: 'confirm',
      note: 'Not ordered on every job — confirm existing drip edge / scope before adding.',
    })
  }

  // 8. Step flashing (pieces set per course)
  const stepLf = pos(linear?.step_flashing_lf)
  if (stepLf > 0) {
    const pieces = Math.ceil(stepLf * STEP_FLASHING_PIECES_PER_LF)
    items.push({
      key: 'step_flashing',
      label: 'Step flashing',
      qty: `~${pieces} pieces`,
      detail: `${fmtLf(stepLf)} LF measured, one piece per course`,
      status: 'confirm',
      note: 'Verify wall runs and reuse vs. replace on site.',
    })
  }

  // 9. Wall / apron flashing (reference)
  const wallLf = pos(linear?.wall_flashing_lf) + pos(linear?.flashing_lf)
  if (wallLf > 0) {
    items.push({
      key: 'wall_flashing',
      label: 'Wall / apron flashing',
      qty: `${fmtLf(wallLf)} LF`,
      detail: 'measured wall + other flashing runs',
      status: 'confirm',
      note: 'Confirm profile and color with the field.',
    })
  }

  // 10. Pipe boots
  const penetrations = pos(input.penetrationCount)
  items.push({
    key: 'pipe_boots',
    label: 'Pipe boots',
    qty: penetrations > 0 ? `${penetrations} (from measure)` : null,
    detail: null,
    status: 'manual',
    note:
      penetrations > 0
        ? 'Verify count and sizes in the field before ordering.'
        : 'Add manually — count penetrations from inspection photos or in the field.',
  })

  return items
}
