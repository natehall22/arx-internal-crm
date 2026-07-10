import type { JobSoldScope } from '@/components/ops/JobSoldScopeSummary'
import {
  buildMaterialsOrderList,
  MATERIALS_ORDER_STARTER_CUSHION_PERCENT,
} from '@/lib/materials-order-list'
import {
  applyMaterialOrderOverrides,
  type DisplayMaterialsOrderItem,
  type JobMaterialOrderOverrideRow,
} from '@/lib/materials-order-overrides'
import type { MaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import { resolveMaterialsCoverageOverrides } from '@/lib/materials-coverage-overrides'
import { parseProjectReviewStored } from '@/lib/project-review'
import { BUNDLES_PER_SQUARE } from '@/lib/roof-shingle-constants'
import { starterFromLinearFt } from '@/lib/starter-strip'

export type WorkOrderMaterialLine = {
  name: string
  quantity: string
  unit: string
}

export type BriefField = {
  value: string | null
  edited?: boolean
  computedValue?: string | null
}

export type JobRoofingBriefFields = {
  shingleColor: BriefField
  fieldShingleSq: BriefField
  ridgeLf: BriefField
  ridgeVentLf: BriefField
  starterSq: BriefField
  stepFlashingLf: BriefField
  wallFlashingLf: BriefField
  accessories: { value: string | null }
  specialRemarks: { value: string | null }
  showNoWasteWarning: boolean
  proposalHref: string | null
  proposalNumber: string | null
}

function pos(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(Number(value))) return 0
  const n = Number(value)
  return n > 0 ? n : 0
}

function fmtLf(n: number): string {
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)
}

function fmtSq(n: number): string {
  return `${n.toFixed(1)} sq`
}

function extractSqFromQty(qty: string | null | undefined): string | null {
  if (!qty) return null
  const match = qty.match(/([\d.]+)\s*sq/i)
  return match ? `${match[1]} sq` : null
}

function extractLfFromQty(qty: string | null | undefined): string | null {
  if (!qty) return null
  const trimmed = qty.trim()
  const match = trimmed.match(/([\d.]+)\s*LF/i)
  if (match) return `${match[1]} LF`
  if (/^[\d.]+$/.test(trimmed)) return `${trimmed} LF`
  return trimmed
}

function extractBundlesFromQty(qty: string | null | undefined): number | null {
  if (!qty) return null
  const match = qty.match(/(\d+)\s*bundle/i)
  return match ? Number.parseInt(match[1], 10) : null
}

function bundlesToStarterSq(bundles: number): string {
  return fmtSq(bundles / BUNDLES_PER_SQUARE)
}

function itemByKey(
  scope: JobSoldScope,
  overrides: JobMaterialOrderOverrideRow[],
  coverageOverrides?: MaterialsCoverageOverrides | null
) {
  const items = buildMaterialsOrderList({
    totalSquaresWithWaste: scope.total_squares,
    linear: scope.roof_measurement_linear,
    ridgeSegmentCount: scope.materials_extras?.ridge_segment_count ?? null,
    lowSlopeAreaSqft: scope.materials_extras?.low_slope_area_sqft ?? null,
    lowSlopeFacetCount: scope.materials_extras?.low_slope_facet_count ?? null,
    penetrationCount: scope.materials_extras?.penetration_count ?? null,
    coverageOverrides,
  })
  return Object.fromEntries(
    applyMaterialOrderOverrides(items, overrides).map((item) => [item.key, item])
  )
}

function resolveShingleColor(project?: {
  product_summary?: string | null
  project_review?: unknown
} | null): string | null {
  if (!project) return null
  const stored = parseProjectReviewStored(project.project_review)
  const fromReview = stored?.answers?.materialsAndProducts?.trim()
  if (fromReview) return fromReview
  const legacy = project.product_summary?.trim()
  return legacy || null
}

function resolveSpecialRemarks(input: {
  specialInstructions?: string | null
  materialsNotes?: string | null
  project?: { project_review?: unknown } | null
}): string | null {
  const parts: string[] = []
  const stored = input.project ? parseProjectReviewStored(input.project.project_review) : null
  const openItems = stored?.answers?.openItems?.trim()
  if (input.specialInstructions?.trim()) parts.push(input.specialInstructions.trim())
  if (input.materialsNotes?.trim()) parts.push(input.materialsNotes.trim())
  if (openItems) parts.push(openItems)
  return parts.length > 0 ? parts.join('\n\n') : null
}

function formatAccessories(input: {
  project?: { project_review?: unknown } | null
  workOrderMaterials?: WorkOrderMaterialLine[]
  pipeBootsQty?: string | null
}): string | null {
  const parts: string[] = []
  const stored = input.project ? parseProjectReviewStored(input.project.project_review) : null
  const reviewAccessories = stored?.answers?.accessories?.trim()
  if (reviewAccessories) parts.push(reviewAccessories)

  for (const line of input.workOrderMaterials ?? []) {
    const name = line.name?.trim()
    if (!name) continue
    const qty = line.quantity?.trim()
    const unit = line.unit?.trim()
    const suffix = [qty, unit].filter(Boolean).join(' ')
    parts.push(suffix ? `${name} — ${suffix}` : name)
  }

  if (input.pipeBootsQty) {
    parts.push(`Pipe boots — ${input.pipeBootsQty}`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

function briefFieldFromItem(
  computed: string | null,
  item: DisplayMaterialsOrderItem | undefined,
  transform: (qty: string) => string | null
): BriefField {
  if (item?.isExcluded) {
    return {
      value: 'Excluded',
      edited: true,
      computedValue: computed,
    }
  }
  if (item?.isEdited && item.qty) {
    const editedValue = transform(item.qty)
    return {
      value: editedValue ?? item.qty,
      edited: true,
      computedValue: computed,
    }
  }
  return { value: computed }
}

export function buildJobRoofingBrief(input: {
  scope: JobSoldScope
  overrides?: JobMaterialOrderOverrideRow[]
  coverageOverrides?: MaterialsCoverageOverrides | null
  project?: {
    product_summary?: string | null
    project_review?: unknown
  } | null
  workOrderMaterials?: WorkOrderMaterialLine[]
  specialInstructions?: string | null
  materialsNotes?: string | null
}): JobRoofingBriefFields {
  const scope = input.scope
  const overrides = input.overrides ?? []
  const cov = input.coverageOverrides ?? resolveMaterialsCoverageOverrides(null)
  const linear = scope.roof_measurement_linear
  const byKey = itemByKey(scope, overrides, cov)

  const fieldItem = byKey.field_shingles
  const computedFieldSq = fieldItem?.computedQty
    ? extractSqFromQty(fieldItem.computedQty)
    : scope.total_squares != null && scope.total_squares > 0
      ? fmtSq(scope.total_squares)
      : null

  const computedRidgeLf =
    linear?.ridges_lf != null && linear.ridges_lf > 0
      ? `${fmtLf(linear.ridges_lf)} LF`
      : null

  const ridgeVentItem = byKey.ridge_vent
  const computedRidgeVentLf = ridgeVentItem?.computedQty
    ? extractLfFromQty(ridgeVentItem.computedQty)
    : null

  const starterItem = byKey.starter
  let computedStarterSq: string | null = null
  if (linear) {
    const starter = starterFromLinearFt({
      eaves_lf: linear.eaves_lf,
      rakes_lf: linear.rakes_lf,
      lfPerBundle: cov.starterLfPerBundle,
      cushionPercent: MATERIALS_ORDER_STARTER_CUSHION_PERCENT,
    })
    if (starter) computedStarterSq = bundlesToStarterSq(starter.bundles)
  }

  const computedStepLf =
    linear?.step_flashing_lf != null && linear.step_flashing_lf > 0
      ? `${fmtLf(linear.step_flashing_lf)} LF`
      : null

  const wallLf = pos(linear?.wall_flashing_lf) + pos(linear?.flashing_lf)
  const computedWallLf = wallLf > 0 ? `${fmtLf(wallLf)} LF` : null

  const fieldShingleSq = briefFieldFromItem(computedFieldSq, fieldItem, (qty) =>
    extractSqFromQty(qty) ?? qty
  )

  const ridgeLf: BriefField = { value: computedRidgeLf }

  const ridgeVentLf = briefFieldFromItem(computedRidgeVentLf, ridgeVentItem, extractLfFromQty)

  const starterSq = briefFieldFromItem(computedStarterSq, starterItem, (qty) => {
    const bundles = extractBundlesFromQty(qty)
    return bundles != null ? bundlesToStarterSq(bundles) : extractSqFromQty(qty) ?? qty
  })

  const stepFlashingLf: BriefField = { value: computedStepLf }

  const wallFlashingLf = briefFieldFromItem(computedWallLf, byKey.wall_flashing, extractLfFromQty)

  const pipeBootsItem = byKey.pipe_boots
  const pipeBootsQty =
    pipeBootsItem && !pipeBootsItem.isExcluded && pipeBootsItem.qty ? pipeBootsItem.qty : null

  const measureWaste =
    scope.measure_suggested_waste_percent != null && scope.measure_suggested_waste_percent > 0
      ? scope.measure_suggested_waste_percent
      : null
  const proposalWastePositive =
    scope.waste_percent != null && scope.waste_percent > 0 && Number.isFinite(Number(scope.waste_percent))
  const hasAnyWastePercent = proposalWastePositive || measureWaste != null
  const proposalHref = scope.proposal_id ? `/proposals/${scope.proposal_id}` : null
  const showNoWasteWarning =
    Boolean(proposalHref) &&
    (scope.source === 'proposal' || scope.total_squares_source === 'roof_measure_total') &&
    !hasAnyWastePercent

  return {
    shingleColor: { value: resolveShingleColor(input.project) },
    fieldShingleSq,
    ridgeLf,
    ridgeVentLf,
    starterSq,
    stepFlashingLf,
    wallFlashingLf,
    accessories: {
      value: formatAccessories({
        project: input.project,
        workOrderMaterials: input.workOrderMaterials,
        pipeBootsQty,
      }),
    },
    specialRemarks: {
      value: resolveSpecialRemarks({
        specialInstructions: input.specialInstructions,
        materialsNotes: input.materialsNotes,
        project: input.project,
      }),
    },
    showNoWasteWarning,
    proposalHref,
    proposalNumber: scope.proposal_number,
  }
}

export function jobRoofingBriefHasContent(fields: JobRoofingBriefFields): boolean {
  return Boolean(
    fields.shingleColor.value ||
      fields.fieldShingleSq.value ||
      fields.ridgeLf.value ||
      fields.ridgeVentLf.value ||
      fields.starterSq.value ||
      fields.stepFlashingLf.value ||
      fields.wallFlashingLf.value ||
      fields.accessories.value ||
      fields.specialRemarks.value ||
      fields.showNoWasteWarning
  )
}
