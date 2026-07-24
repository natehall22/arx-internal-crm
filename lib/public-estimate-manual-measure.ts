/** Pure detection for complex-roof / unreliable auto-estimate (no Solar imports). */

export function isPublicEstimateManualMeasureRequired(input: {
  no_roof_data?: boolean
  measure_source?: string
  facet_count?: number
  /** Whole-mask vs segments disagree materially — Instant Estimate must not auto-price. */
  force_manual_reconcile?: boolean
}): boolean {
  if (input.no_roof_data) return true
  if (input.force_manual_reconcile) return true
  const facets = input.facet_count ?? 0
  if (facets >= 7) return true
  // solar_reconciled uses mask facet count only — do not apply segments≥5 rule.
  if (input.measure_source === 'solar_segments' && facets >= 5) return true
  return false
}
