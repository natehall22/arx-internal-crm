import { azimuthToCompassString } from './roof-measure-edge-classification'

export interface AuroraEdgesLength {
  eave?: number
  hip?: number
  rake?: number
  ridge?: number
  valley?: number
}

export interface AuroraRoofFace {
  area?: number
  modules_area?: number
  azimuth?: number
  pitch?: number
  modules?: boolean
}

export interface AuroraRoofSummaryRoof {
  area?: number
  modules_area?: number
  pitch?: number | null
  modules?: boolean
  edges_length?: AuroraEdgesLength
  faces?: AuroraRoofFace[]
}

export interface AuroraRoofSummary {
  roofs?: AuroraRoofSummaryRoof[]
}

export interface MappedAuroraRoofMeasurement {
  ridges_lf: number
  hips_lf: number
  valleys_lf: number
  eaves_lf: number
  rakes_lf: number
  total_area_sqft: number
  facet_count: number
  predominant_pitch: string
  facets: Array<{
    area_sqft: number
    pitch: string
    pitch_degrees: number
    pitch_rise: number
    orientation: string
  }>
}

function roundLf(value: number): number {
  return Math.round(value)
}

function pitchDegreesToRise12(pitchDegrees: number): number {
  if (!Number.isFinite(pitchDegrees) || pitchDegrees <= 0) return 0
  return Math.round(12 * Math.tan((pitchDegrees * Math.PI) / 180))
}

function pitchDegreesToLabel(pitchDegrees: number): string {
  const rise = pitchDegreesToRise12(pitchDegrees)
  return rise > 0 ? `${rise}/12` : 'Unset'
}

function sumEdges(roofs: AuroraRoofSummaryRoof[]): AuroraEdgesLength {
  const totals: Required<AuroraEdgesLength> = {
    eave: 0,
    hip: 0,
    rake: 0,
    ridge: 0,
    valley: 0,
  }
  for (const roof of roofs) {
    const edges = roof.edges_length
    if (!edges) continue
    totals.eave += edges.eave ?? 0
    totals.hip += edges.hip ?? 0
    totals.rake += edges.rake ?? 0
    totals.ridge += edges.ridge ?? 0
    totals.valley += edges.valley ?? 0
  }
  return totals
}

/**
 * Maps Aurora GET .../designs/{id}/roof_summary JSON to ARX roof_measurements columns.
 * Sums edges_length across all roofs (detached structures are separate roof objects in Aurora).
 */
export function mapAuroraRoofSummaryToMeasurement(
  summary: AuroraRoofSummary
): MappedAuroraRoofMeasurement {
  const roofs = summary.roofs ?? []
  const edges = sumEdges(roofs)

  const facets: MappedAuroraRoofMeasurement['facets'] = []
  let totalArea = 0
  const pitchAreaWeights: Record<string, number> = {}

  for (const roof of roofs) {
    for (const face of roof.faces ?? []) {
      const area = face.area ?? 0
      if (area <= 0) continue
      const pitchDeg = face.pitch ?? roof.pitch ?? 0
      const pitchLabel = pitchDegreesToLabel(pitchDeg)
      totalArea += area
      pitchAreaWeights[pitchLabel] = (pitchAreaWeights[pitchLabel] ?? 0) + area
      facets.push({
        area_sqft: Math.round(area),
        pitch: pitchLabel,
        pitch_degrees: pitchDeg,
        pitch_rise: pitchDegreesToRise12(pitchDeg),
        orientation:
          typeof face.azimuth === 'number'
            ? azimuthToCompassString(face.azimuth)
            : 'N',
      })
    }
  }

  const predominant_pitch =
    Object.entries(pitchAreaWeights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unset'

  return {
    ridges_lf: roundLf(edges.ridge ?? 0),
    hips_lf: roundLf(edges.hip ?? 0),
    valleys_lf: roundLf(edges.valley ?? 0),
    eaves_lf: roundLf(edges.eave ?? 0),
    rakes_lf: roundLf(edges.rake ?? 0),
    total_area_sqft: Math.round(totalArea),
    facet_count: facets.length,
    predominant_pitch,
    facets,
  }
}
