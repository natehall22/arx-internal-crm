import { isConfirmedPitchSource } from '@/lib/roof-measure-solar-pitch'

describe('measurements save pitch gate', () => {
  it('accepts solar_auto and manual pitch sources', () => {
    expect(isConfirmedPitchSource('manual')).toBe(true)
    expect(isConfirmedPitchSource('solar_auto')).toBe(true)
    expect(isConfirmedPitchSource('unknown')).toBe(false)
    expect(isConfirmedPitchSource(undefined)).toBe(false)
  })
})
