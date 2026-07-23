/** Pure detection for complex-roof / unreliable auto-estimate (no Solar imports). */

export function isPublicEstimateManualMeasureRequired(input: {
  no_roof_data?: boolean
  measure_source?: string
  facet_count?: number
}): boolean {
  if (input.no_roof_data) return true
  const facets = input.facet_count ?? 0
  if (facets >= 7) return true
  if (input.measure_source === 'solar_segments' && facets >= 5) return true
  return false
}
