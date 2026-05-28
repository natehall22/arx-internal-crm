import {
  isConfirmedPitchSource,
  shouldAutoApplySolarPitch,
  SOLAR_PITCH_AUTO_APPLY_MIN_CONFIDENCE,
} from '@/lib/roof-measure-solar-pitch'

describe('roof-measure-solar-pitch', () => {
  describe('shouldAutoApplySolarPitch', () => {
    it('requires suggested pitch values', () => {
      expect(
        shouldAutoApplySolarPitch({
          suggested_pitch: null,
          suggested_pitch_degrees: 26.57,
          facet_source: 'solar_mask_plane',
        })
      ).toBe(false)
    })

    it('auto-applies for solar_mask_plane with segment pitch', () => {
      expect(
        shouldAutoApplySolarPitch({
          suggested_pitch: '6/12',
          suggested_pitch_degrees: 26.57,
          facet_source: 'solar_mask_plane',
          confidence: 0.35,
        })
      ).toBe(true)
    })

    it('auto-applies when matched to a Solar segment index', () => {
      expect(
        shouldAutoApplySolarPitch({
          suggested_pitch: '4/12',
          suggested_pitch_degrees: 18.43,
          solar_segment_index: 2,
          confidence: 0.4,
        })
      ).toBe(true)
    })

    it('auto-applies at or above confidence threshold', () => {
      expect(
        shouldAutoApplySolarPitch({
          suggested_pitch: '8/12',
          suggested_pitch_degrees: 33.69,
          confidence: SOLAR_PITCH_AUTO_APPLY_MIN_CONFIDENCE,
        })
      ).toBe(true)
      expect(
        shouldAutoApplySolarPitch({
          suggested_pitch: '8/12',
          suggested_pitch_degrees: 33.69,
          confidence: SOLAR_PITCH_AUTO_APPLY_MIN_CONFIDENCE - 0.01,
        })
      ).toBe(false)
    })
  })

  describe('isConfirmedPitchSource', () => {
    it('treats manual and solar_auto as confirmed', () => {
      expect(isConfirmedPitchSource('manual')).toBe(true)
      expect(isConfirmedPitchSource('solar_auto')).toBe(true)
      expect(isConfirmedPitchSource('unknown')).toBe(false)
      expect(isConfirmedPitchSource(undefined)).toBe(false)
    })
  })
})
