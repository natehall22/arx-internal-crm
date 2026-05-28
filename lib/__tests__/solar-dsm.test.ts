jest.mock('geotiff', () => ({}))
jest.mock('geotiff-geokeys-to-proj4', () => ({}))
jest.mock('proj4', () => jest.fn())

import { pitchDegreesFromDsmHeights, dsmPitchDisagreesWithSolar } from '@/lib/solar-dsm'

describe('solar dsm', () => {
  it('detects pitch disagreement above threshold', () => {
    expect(dsmPitchDisagreesWithSolar(22, 25, 3)).toBe(false)
    expect(dsmPitchDisagreesWithSolar(22, 30, 3)).toBe(true)
  })

  it('estimates pitch from height samples along azimuth', () => {
    const pitch = pitchDegreesFromDsmHeights(
      [
        { lat: 35.41, lng: -80.6, h: 250 },
        { lat: 35.409, lng: -80.6, h: 248 },
      ],
      180
    )
    expect(pitch).not.toBeNull()
    if (pitch != null) expect(pitch).toBeGreaterThan(0)
  })
})
