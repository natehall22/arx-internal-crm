import type { SolarMaskAttemptResult, SolarMaskFacetPayload, SolarMaskSegment } from '@/lib/solar-roof-mask-facets'

export type MaskClassification = 'relaxed_split' | 'quality_split' | 'whole' | 'none'

export type SquaresBundle = {
  baseSquares: number
  facetCount: number
  avgPitchMultiplier: number
}

export type PublicEstimateMeasureSelection = {
  /** Chosen base for waste + pricing. */
  chosen: SquaresBundle
  measure_source: string
  measure_select_reason: string
  mask_classification: MaskClassification
  /** When both measures exist. */
  mask_base_squares: number | null
  segments_base_squares: number | null
  split_quality_mode: string | null
  /** Whole-mask vs segments disagree materially — force manual path. */
  force_manual_reconcile: boolean
  /** Mask facet count when mask was attempted (for waste + manual gate). */
  mask_facet_count: number | null
  segment_count: number
}

const RELAXED_MODES = new Set(['relaxed', 'nonoverlap'])
const QUALITY_MODES = new Set(['strict', 'pruned'])

export function classifySolarMaskAttempt(mask: SolarMaskAttemptResult | null): MaskClassification {
  if (!mask?.facets?.length) return 'none'

  const path = mask.details?.path
  if (
    path === 'whole_mask_contour' ||
    mask.facets.some((f) => f.facet_source === 'solar_mask_whole')
  ) {
    return 'whole'
  }

  const mode = mask.details?.split_quality_mode
  if (typeof mode === 'string') {
    if (RELAXED_MODES.has(mode)) return 'relaxed_split'
    if (QUALITY_MODES.has(mode)) return 'quality_split'
  }

  const pathStr = typeof path === 'string' ? path : ''
  if (pathStr.includes('nonoverlap') || pathStr.includes('relaxed')) return 'relaxed_split'
  if (pathStr.includes('split_mask_plane')) return 'quality_split'

  return 'none'
}

function relativeSquaresDiff(a: number, b: number): number {
  const denom = Math.max(a, b)
  if (denom <= 0) return 0
  return Math.abs(a - b) / denom
}

/**
 * Instant Estimate dual-measure reconcile — mask vs Solar segments.
 * CRM mask split cascade is unchanged; this only picks which base squares to price.
 */
export function selectPublicEstimateMeasure(input: {
  maskAttempt: SolarMaskAttemptResult | null
  maskSquares: SquaresBundle | null
  segmentSquares: SquaresBundle | null
  segmentCount: number
}): PublicEstimateMeasureSelection | null {
  const { maskAttempt, maskSquares, segmentSquares, segmentCount } = input
  const classification = classifySolarMaskAttempt(maskAttempt)
  const splitMode =
    typeof maskAttempt?.details?.split_quality_mode === 'string'
      ? maskAttempt.details.split_quality_mode
      : null

  const M = maskSquares?.baseSquares ?? null
  const S = segmentSquares?.baseSquares ?? null
  const maskFacetCount = maskSquares?.facetCount ?? maskAttempt?.facets?.length ?? null
  const rel = M != null && S != null ? relativeSquaresDiff(M, S) : null

  if (classification === 'none' || M == null || !maskSquares) {
    if (!segmentSquares) return null
    return {
      mask_classification: 'none',
      mask_base_squares: null,
      segments_base_squares: S,
      split_quality_mode: null,
      mask_facet_count: null,
      segment_count: segmentCount,
      force_manual_reconcile: false,
      measure_select_reason: 'no_mask_segments_only',
      chosen: segmentSquares,
      measure_source: 'solar_segments',
    }
  }

  if (S == null || !segmentSquares) {
    return {
      mask_classification: classification,
      mask_base_squares: M,
      segments_base_squares: null,
      split_quality_mode: splitMode,
      mask_facet_count: maskFacetCount,
      segment_count: segmentCount,
      force_manual_reconcile: false,
      measure_select_reason: 'mask_only_no_segment_squares',
      chosen: maskSquares,
      measure_source: classification === 'whole' ? 'solar_mask_whole' : 'solar_mask',
    }
  }

  const wasteFacetCount = maskFacetCount ?? segmentSquares.facetCount

  if (classification === 'relaxed_split') {
    return {
      mask_classification: classification,
      mask_base_squares: M,
      segments_base_squares: S,
      split_quality_mode: splitMode,
      mask_facet_count: maskFacetCount,
      segment_count: segmentCount,
      force_manual_reconcile: false,
      measure_select_reason: 'relaxed_split_reconcile_to_segments',
      chosen: { ...segmentSquares, facetCount: wasteFacetCount },
      measure_source: 'solar_reconciled',
    }
  }

  if (classification === 'quality_split') {
    if (M < 0.85 * S) {
      return {
        mask_classification: classification,
        mask_base_squares: M,
        segments_base_squares: S,
        split_quality_mode: splitMode,
        mask_facet_count: maskFacetCount,
        segment_count: segmentCount,
        force_manual_reconcile: false,
        measure_select_reason: 'quality_split_undercover_reconcile_to_segments',
        chosen: { ...segmentSquares, facetCount: wasteFacetCount },
        measure_source: 'solar_reconciled',
      }
    }
    return {
      mask_classification: classification,
      mask_base_squares: M,
      segments_base_squares: S,
      split_quality_mode: splitMode,
      mask_facet_count: maskFacetCount,
      segment_count: segmentCount,
      force_manual_reconcile: false,
      measure_select_reason: 'quality_split_use_mask',
      chosen: maskSquares,
      measure_source: 'solar_mask',
    }
  }

  if (classification === 'whole') {
    const disagree = (rel != null && rel > 0.2) || segmentCount >= 5
    if (disagree) {
      return {
        mask_classification: classification,
        mask_base_squares: M,
        segments_base_squares: S,
        split_quality_mode: splitMode,
        mask_facet_count: maskFacetCount,
        segment_count: segmentCount,
        force_manual_reconcile: true,
        measure_select_reason:
          rel != null && rel > 0.2
            ? 'whole_mask_segment_disagree_rel'
            : 'whole_mask_segment_disagree_seg_count',
        chosen: { ...segmentSquares, facetCount: wasteFacetCount },
        measure_source: 'solar_mask_whole',
      }
    }
    return {
      mask_classification: classification,
      mask_base_squares: M,
      segments_base_squares: S,
      split_quality_mode: splitMode,
      mask_facet_count: maskFacetCount,
      segment_count: segmentCount,
      force_manual_reconcile: false,
      measure_select_reason: 'whole_mask_agrees_with_segments',
      chosen: maskSquares,
      measure_source: 'solar_mask_whole',
    }
  }

  // Unclassified mask with facets — default to mask.
  return {
    mask_classification: classification,
    mask_base_squares: M,
    segments_base_squares: S,
    split_quality_mode: splitMode,
    mask_facet_count: maskFacetCount,
    segment_count: segmentCount,
    force_manual_reconcile: false,
    measure_select_reason: 'unclassified_mask_default',
    chosen: maskSquares,
    measure_source: 'solar_mask',
  }
}

/** Test helper — minimal facet list for mask classification. */
export function maskAttemptFromClassification(
  classification: MaskClassification,
  facets: SolarMaskFacetPayload[],
  extras?: { M?: number; split_quality_mode?: string }
): SolarMaskAttemptResult {
  const details: Record<string, string | number | boolean | null> = {}
  if (classification === 'whole') {
    details.path = 'whole_mask_contour'
  } else if (classification === 'relaxed_split') {
    details.path = 'split_mask_plane_relaxed'
    details.split_quality_mode = extras?.split_quality_mode ?? 'relaxed'
  } else if (classification === 'quality_split') {
    details.path = 'split_mask_plane'
    details.split_quality_mode = extras?.split_quality_mode ?? 'strict'
  }
  return { facets, reason: facets.length ? 'ok' : 'no_roof_pixels', details }
}

export type { SolarMaskSegment }
