import { azimuthToCompassString } from './roof-measure-edge-classification'

const SQFT_PER_SQM = 10.763910417

export function normalizeAzimuthDegrees(azimuth: number): number {
  if (!Number.isFinite(azimuth)) return 0
  return ((azimuth % 360) + 360) % 360
}

/** Google Solar / Aurora: compass direction the roof plane faces (panel normal). */
export function facingCompassFromAzimuthDegrees(azimuthDegrees: number | null | undefined): string {
  if (azimuthDegrees == null || !Number.isFinite(azimuthDegrees)) return 'N'
  return azimuthToCompassString(normalizeAzimuthDegrees(azimuthDegrees))
}

export function pitchRiseFromDegrees(pitchDegrees: number | null | undefined): number {
  if (pitchDegrees == null || !Number.isFinite(pitchDegrees) || pitchDegrees <= 0) return 0
  return Math.round(12 * Math.tan((pitchDegrees * Math.PI) / 180))
}

export function pitchLabelFromDegrees(pitchDegrees: number | null | undefined): string | null {
  const rise = pitchRiseFromDegrees(pitchDegrees)
  return rise > 0 ? `${rise}/12` : null
}

export function slopedAreaSqftFromMeters2(areaM2: number | null | undefined): number | null {
  if (areaM2 == null || !Number.isFinite(areaM2) || areaM2 <= 0) return null
  return Math.round(areaM2 * SQFT_PER_SQM)
}

export function footprintAreaSqftFromMeters2(groundM2: number | null | undefined): number | null {
  return slopedAreaSqftFromMeters2(groundM2)
}

export type AreaCrossCheck = {
  arxSlopedSqft: number
  solarSlopedSqft: number
  deltaPct: number
}

/** Non-blocking warning when drawn sloped area diverges from Solar segment sloped area. */
export function areaCrossCheck(
  arxSlopedSqft: number,
  solarSlopedSqft: number | null,
  thresholdPct = 10
): AreaCrossCheck | null {
  if (solarSlopedSqft == null || solarSlopedSqft <= 0 || arxSlopedSqft <= 0) return null
  const deltaPct = Math.round((Math.abs(arxSlopedSqft - solarSlopedSqft) / solarSlopedSqft) * 100)
  if (deltaPct <= thresholdPct) return null
  return { arxSlopedSqft, solarSlopedSqft, deltaPct }
}
