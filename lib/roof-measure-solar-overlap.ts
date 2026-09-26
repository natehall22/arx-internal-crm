export const SOLAR_OVERLAP_SAVE_THRESHOLD = 1.08
export const SOLAR_OVERLAP_MIN_REFERENCE_SQFT = 350

export type SolarOverlapCheck = {
  /** Drawn footprint exceeds Solar reference — show a verification note. */
  detected: boolean
  /** Hard block on quote-ready save (false when manual sections likely explain the gap). */
  blocksSave: boolean
  ratio: number | null
  drawnFlatSqft: number
  solarGroundSqft: number | null
  fromVision: boolean
  manualDrawFacetCount: number
}

export function isVisionGeometrySource(source: string | null | undefined): boolean {
  return source === 'vision' || source === 'vision_solar_guided'
}

export function isManuallyDrawnFacet(facet: {
  origin?: string | null
  geometry_source?: string | null
}): boolean {
  return (
    facet.origin === 'manual_draw' ||
    facet.geometry_source === 'manual_draw' ||
    facet.geometry_source === 'manual_corrected'
  )
}

export function checkSolarFootprintOverlap(args: {
  flatAreaSqft: number
  solarGroundSqft: number | null
  geometrySource: string | null
  manualDrawFacetCount?: number
}): SolarOverlapCheck {
  const fromVision = isVisionGeometrySource(args.geometrySource)
  const solarGroundSqft = args.solarGroundSqft
  const manualDrawFacetCount = args.manualDrawFacetCount ?? 0
  const base = {
    drawnFlatSqft: args.flatAreaSqft,
    solarGroundSqft,
    fromVision,
    manualDrawFacetCount,
  }

  if (fromVision || solarGroundSqft == null || solarGroundSqft < SOLAR_OVERLAP_MIN_REFERENCE_SQFT) {
    return { detected: false, blocksSave: false, ratio: null, ...base }
  }

  const ratio = args.flatAreaSqft / solarGroundSqft
  const detected = ratio > SOLAR_OVERLAP_SAVE_THRESHOLD
  // Hand-drawn sections often cover planes Google Solar missed — warn, don't block.
  const blocksSave = detected && manualDrawFacetCount === 0

  return {
    detected,
    blocksSave,
    ratio,
    ...base,
  }
}

export function overlapValidationNote(check: SolarOverlapCheck): string | null {
  if (!check.detected || check.ratio == null || check.solarGroundSqft == null) return null
  const overlapPct = Math.round((check.ratio - 1) * 100)
  if (check.manualDrawFacetCount > 0) {
    return (
      `Drawn footprint is ${overlapPct}% above Google Solar's reference (~${Math.round(check.solarGroundSqft).toLocaleString()} sq ft). ` +
      `You have ${check.manualDrawFacetCount} hand-drawn section${check.manualDrawFacetCount === 1 ? '' : 's'} — Solar often undercounts complex roofs. ` +
      `Verify totals on the map; use Save for review if you want ops to double-check.`
    )
  }
  return (
    `Polygon overlap detected: drawn sections total ${Math.round(check.drawnFlatSqft).toLocaleString()} sq ft ` +
    `but Google Solar shows ~${Math.round(check.solarGroundSqft).toLocaleString()} sq ft footprint (${overlapPct}% over). ` +
    `Delete or resize overlapping sections before saving, or use Save for review if you verified the totals.`
  )
}

/**
 * Under-coverage: the drawn roof is well SMALLER than Google's footprint for the
 * building, i.e. a section (addition, porch, garage wing) was probably never drawn.
 *
 * Calibrated on the 12 carrier-scored fixtures (2026-09-26): every under-measured job
 * sat at 0.40–0.83 of Google's ground area (Briarfield, Denbur, Florence, Peduto's
 * missed addition), every correctly measured one at 0.97–1.17 (drawn roofs include
 * eave overhang, which Google's ground area doesn't). Advisory only — never blocks.
 * Google sometimes locks onto a neighbor or one wing (Kaestner read 250 sq ft), which
 * only ever makes the ratio LARGER, so it can't create a false "missing area" note.
 */
export const SOLAR_COVERAGE_UNDER_THRESHOLD = 0.88

export function solarCoverageNote(flatAreaSqft: number, solarGroundSqft: number | null): string | null {
  if (solarGroundSqft == null || solarGroundSqft < SOLAR_OVERLAP_MIN_REFERENCE_SQFT || flatAreaSqft <= 0) return null
  const ratio = flatAreaSqft / solarGroundSqft
  if (ratio >= SOLAR_COVERAGE_UNDER_THRESHOLD) return null
  const missing = Math.round(solarGroundSqft - flatAreaSqft)
  return (
    `Drawn roof is ${Math.round((1 - ratio) * 100)}% smaller than Google's footprint for this building ` +
    `(~${Math.round(solarGroundSqft).toLocaleString()} sq ft) — about ${missing.toLocaleString()} sq ft may be missing. ` +
    `Check for an addition, porch, or garage wing that isn't drawn.`
  )
}
