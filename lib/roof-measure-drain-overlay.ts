import {
  buildSharedEdgeSet,
  computeFacetDrainAzimuth,
  type DrainAzimuthSource,
} from './roof-measure-edge-classification'
import type { RoofMeasurePoint } from './roof-measure-geometry'

export type FacetDrainFields = {
  id: string
  points: RoofMeasurePoint[]
  drain_azimuth_degrees?: number | null
  drain_azimuth_source?: DrainAzimuthSource
  suggested_drain_azimuth_degrees?: number | null
  section_type?: string
}

/** Matches classifier precedence: manual drain when source=manual, else footprint auto. */
export function displayFacetDrainAzimuth(facet: FacetDrainFields, allFacets: FacetDrainFields[]): number {
  if (
    facet.drain_azimuth_source === 'manual' &&
    facet.drain_azimuth_degrees != null &&
    Number.isFinite(facet.drain_azimuth_degrees)
  ) {
    return ((facet.drain_azimuth_degrees % 360) + 360) % 360
  }
  return computeSuggestedDrainAzimuth(facet, allFacets)
}

export function computeSuggestedDrainAzimuth(facet: FacetDrainFields, allFacets: FacetDrainFields[]): number {
  const shared = buildSharedEdgeSet(allFacets.map((f) => ({ id: f.id, points: f.points })))
  return computeFacetDrainAzimuth(facet.points, facet.id, shared)
}

export function snapAzimuthDegrees(deg: number, snap = 15): number {
  const normalized = ((deg % 360) + 360) % 360
  return ((Math.round(normalized / snap) * snap) % 360 + 360) % 360
}

export function drainSourceLabel(source?: DrainAzimuthSource): string {
  switch (source) {
    case 'manual':
      return 'manual'
    case 'solar_hint':
      return 'Solar hint'
    default:
      return 'from outline'
  }
}

export function needsDrainReview(
  facet: FacetDrainFields,
  context: {
    measurementConfidence?: 'high' | 'medium' | 'low'
    validationNotes?: string[]
    unclassifiedSharedLf?: number
    hipsLf?: number
    valleysLf?: number
    ridgesLf?: number
    facetCount?: number
  }
): boolean {
  if (facet.section_type === 'dormer') return true
  if (context.unclassifiedSharedLf != null && context.unclassifiedSharedLf > 0) return true
  const facetCount = context.facetCount ?? 0
  if (
    facetCount >= 4 &&
    (context.hipsLf ?? 0) === 0 &&
    (context.valleysLf ?? 0) >= 60 &&
    (context.ridgesLf ?? 0) > 0
  ) {
    return true
  }
  if (context.measurementConfidence && context.measurementConfidence !== 'high') return true
  const notes = context.validationNotes ?? []
  if (notes.some((n) => n.includes('could not be classified'))) return true
  if (notes.some((n) => n.includes('No hip LF on a multi-section'))) return true
  return false
}

export function enrichFacetDrainDefaults<T extends FacetDrainFields>(
  facet: T,
  allFacets: FacetDrainFields[]
): T {
  const suggested = computeSuggestedDrainAzimuth(facet, allFacets)
  return {
    ...facet,
    suggested_drain_azimuth_degrees: facet.suggested_drain_azimuth_degrees ?? suggested,
    drain_azimuth_source: facet.drain_azimuth_source ?? 'footprint_auto',
  }
}
