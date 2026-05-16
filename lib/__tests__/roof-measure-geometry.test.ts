import {
  approximatePlanarPolygonAreaSqft,
  haversineDistanceFeet,
  pitchDegreesFromRise,
  pitchMultiplierFromRise,
  polygonPerimeterFeet,
  roofSurfaceSqft,
} from '@/lib/roof-measure-geometry'

describe('roof-measure-geometry', () => {
  it('calculates industry pitch multipliers from rise over 12', () => {
    expect(pitchMultiplierFromRise(0)).toBeCloseTo(1, 3)
    expect(pitchMultiplierFromRise(4)).toBeCloseTo(1.054, 3)
    expect(pitchMultiplierFromRise(6)).toBeCloseTo(1.118, 3)
    expect(pitchMultiplierFromRise(8)).toBeCloseTo(1.202, 3)
    expect(pitchMultiplierFromRise(12)).toBeCloseTo(1.414, 3)
  })

  it('calculates pitch degrees from rise over 12', () => {
    expect(pitchDegreesFromRise(0)).toBe(0)
    expect(pitchDegreesFromRise(6)).toBeCloseTo(26.565, 3)
    expect(pitchDegreesFromRise(12)).toBeCloseTo(45, 3)
  })

  it('applies pitch multiplier to flat roof footprint area', () => {
    expect(roofSurfaceSqft(1000, 6)).toBeCloseTo(1118.034, 3)
  })

  it('measures haversine distance at residential scale', () => {
    const feet = haversineDistanceFeet(
      { lat: 35.000000, lng: -80.000000 },
      { lat: 35.000274, lng: -80.000000 }
    )

    expect(feet).toBeCloseTo(100, 0)
  })

  it('approximates small polygon area and perimeter consistently', () => {
    const origin = { lat: 35.000000, lng: -80.000000 }
    const north100 = { lat: 35.000274, lng: -80.000000 }
    const east100 = { lat: 35.000000, lng: -79.999665 }
    const northeast100 = { lat: 35.000274, lng: -79.999665 }
    const square = [origin, east100, northeast100, north100]

    expect(approximatePlanarPolygonAreaSqft(square)).toBeCloseTo(10000, -2)
    expect(polygonPerimeterFeet(square)).toBeCloseTo(400, -1)
  })
})

