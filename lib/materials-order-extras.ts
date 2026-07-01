/** Extra measurement-derived inputs for the ops materials order list (all optional/additive). */
export type JobSoldScopeMaterialsExtras = {
  ridge_segment_count: number | null
  low_slope_area_sqft: number | null
  low_slope_facet_count: number | null
  penetration_count: number | null
}

/**
 * Low-slope (≤1/12) facet totals + ridge run count from measurement raw_data — best effort, all nullable.
 */
export function buildMaterialsExtras(
  row: {
    penetration_count?: number | null
    raw_data?: unknown
  } | null
): JobSoldScopeMaterialsExtras | null {
  if (!row) return null
  const raw =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : null

  let lowSlopeAreaSqft: number | null = null
  let lowSlopeFacetCount: number | null = null
  if (raw && Array.isArray(raw.facets)) {
    let area = 0
    let count = 0
    for (const f of raw.facets as Array<Record<string, unknown>>) {
      if (!f || typeof f !== 'object') continue
      let rise = typeof f.pitch_rise === 'number' && Number.isFinite(f.pitch_rise) ? f.pitch_rise : null
      if (rise == null && typeof f.pitch === 'string') {
        const m = /^(\d+(?:\.\d+)?)\s*\/\s*12/.exec(f.pitch.trim())
        if (m) rise = Number(m[1])
      }
      if (rise == null || rise > 1) continue
      const facetArea = typeof f.area_sqft === 'number' && Number.isFinite(f.area_sqft) ? f.area_sqft : 0
      if (facetArea > 0) {
        area += facetArea
        count += 1
      }
    }
    if (count > 0) {
      lowSlopeAreaSqft = Math.round(area)
      lowSlopeFacetCount = count
    }
  }

  let ridgeSegmentCount: number | null = null
  if (raw && typeof raw.ridge_run_count === 'number' && raw.ridge_run_count > 0) {
    ridgeSegmentCount = Math.floor(raw.ridge_run_count)
  } else if (raw && Array.isArray(raw.linear_features)) {
    const ridgeRuns = (raw.linear_features as Array<Record<string, unknown>>).filter(
      (f) => f && typeof f === 'object' && f.type === 'ridge'
    ).length
    if (ridgeRuns > 0) ridgeSegmentCount = ridgeRuns
  }

  const penetrationCount =
    typeof row.penetration_count === 'number' && row.penetration_count > 0
      ? Math.floor(row.penetration_count)
      : raw && typeof raw.penetration_count === 'number' && raw.penetration_count > 0
        ? Math.floor(raw.penetration_count)
        : null

  if (lowSlopeAreaSqft == null && ridgeSegmentCount == null && penetrationCount == null) {
    return null
  }

  return {
    ridge_segment_count: ridgeSegmentCount,
    low_slope_area_sqft: lowSlopeAreaSqft,
    low_slope_facet_count: lowSlopeFacetCount,
    penetration_count: penetrationCount,
  }
}
