import {
  areaCrossCheck,
  facingCompassFromAzimuthDegrees,
  pitchLabelFromDegrees,
  pitchRiseFromDegrees,
  slopedAreaSqftFromMeters2,
} from '@/lib/roof-face-solar-alignment'

describe('roof-face-solar-alignment', () => {
  it('maps facing azimuth to compass (Google convention)', () => {
    expect(facingCompassFromAzimuthDegrees(0)).toBe('N')
    expect(facingCompassFromAzimuthDegrees(90)).toBe('E')
    expect(facingCompassFromAzimuthDegrees(180)).toBe('S')
    expect(facingCompassFromAzimuthDegrees(75)).toBe('E')
  })

  it('converts pitch degrees to rise/12', () => {
    expect(pitchRiseFromDegrees(20)).toBeGreaterThanOrEqual(4)
    expect(pitchLabelFromDegrees(20)).toMatch(/\/12$/)
  })

  it('converts segment area m² to sqft', () => {
    expect(slopedAreaSqftFromMeters2(100)).toBeCloseTo(1076, -1)
  })

  it('flags area cross-check above threshold', () => {
    const check = areaCrossCheck(1200, 1000, 10)
    expect(check?.deltaPct).toBe(20)
    expect(areaCrossCheck(1050, 1000, 10)).toBeNull()
  })
})
