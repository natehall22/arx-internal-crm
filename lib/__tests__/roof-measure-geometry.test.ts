import {
  approximatePlanarPolygonAreaSqft,
  haversineDistanceFeet,
  pitchDegreesFromRise,
  pitchMultiplierFromRise,
  polygonPerimeterFeet,
  roofSurfaceSqft,
  slopedAreaSqft,
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

  it('computes sloped area from the drawn footprint × pitch, always ≥ flat', () => {
    // Solar's segment sloped area is not used directly: a polygon larger than Solar's
    // segment would otherwise report sloped < flat (the under-measurement bug — e.g. a
    // 972 ft² flat plane showing 828 ft² "roof surface").
    const buggyCase = slopedAreaSqft({
      flat_area_sqft: 972,
      pitch_rise: 7,
      suggested_sloped_area_sqft: 828,
      geometry_source: 'solar_mask_plane',
    })
    expect(buggyCase).toBe(Math.round(roofSurfaceSqft(972, 7)))
    expect(buggyCase).toBeGreaterThanOrEqual(972)
    // Footprint × pitch is authoritative regardless of geometry source.
    expect(
      slopedAreaSqft({ flat_area_sqft: 1000, pitch_rise: 6, geometry_source: 'solar_mask_plane' })
    ).toBeCloseTo(1118, 0)
    expect(
      slopedAreaSqft({ flat_area_sqft: 1000, pitch_rise: 6, geometry_source: 'solar_bbox' })
    ).toBeCloseTo(1118, 0)
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

