/** Minimum facet confidence before auto-applying Solar pitch on accept (matches detect-roof vision threshold). */
export const SOLAR_PITCH_AUTO_APPLY_MIN_CONFIDENCE = 0.65

export type RoofPitchSource = 'manual' | 'unknown' | 'solar_auto'

export type SolarPitchDraftInput = {
  suggested_pitch?: string | null
  suggested_pitch_degrees?: number | null
  confidence?: number
  facet_source?: string | null
  solar_segment_index?: number | null
}

export function shouldAutoApplySolarPitch(draft: SolarPitchDraftInput): boolean {
  if (!draft.suggested_pitch || typeof draft.suggested_pitch_degrees !== 'number') {
    return false
  }
  if (draft.facet_source === 'solar_mask_plane') return true
  if (typeof draft.solar_segment_index === 'number') return true
  return (draft.confidence ?? 0) >= SOLAR_PITCH_AUTO_APPLY_MIN_CONFIDENCE
}

export function isConfirmedPitchSource(source: RoofPitchSource | undefined): boolean {
  return source === 'manual' || source === 'solar_auto'
}
