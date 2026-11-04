import { pitchMultiplierFromRise } from '@/lib/roof-measure-geometry'
import { PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE } from '@/lib/public-estimate-config'

/** Below 2/12 (~9.5°) shingles aren't allowed — the section needs a low-slope system. */
export const LOW_SLOPE_DEGREES = 9.46

/**
 * Sloped-area multiplier from a measured pitch. A real low/flat reading keeps its own (≈1.0)
 * multiplier — only a MISSING pitch falls back to the 6/12 default (it used to treat any
 * pitch under ~2.4° as missing and bill porches/flat decks as 6/12).
 */
export function pitchMultiplierFromDegrees(pitchDegrees: number | null | undefined): number {
  if (pitchDegrees == null || !Number.isFinite(pitchDegrees) || pitchDegrees < 0 || pitchDegrees >= 80) {
    return pitchMultiplierFromRise(PUBLIC_ESTIMATE_DEFAULT_PITCH_RISE)
  }
  return 1 / Math.cos((pitchDegrees * Math.PI) / 180)
}

