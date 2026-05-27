import { mapAuroraRoofSummaryToMeasurement } from '@/lib/aurora-roof-summary-mapper'

const AURORA_SAMPLE = {
  roofs: [
    {
      area: 1500,
      modules_area: 500,
      pitch: null,
      modules: true,
      edges_length: {
        eave: 100,
        hip: 100,
        rake: 100,
        ridge: 100,
        valley: 100,
      },
      faces: [
        {
          area: 1000,
          modules_area: 500,
          azimuth: 75,
          pitch: 20,
          modules: true,
        },
        {
          area: 500,
          modules_area: 500,
          azimuth: 25,
          pitch: 22,
          modules: false,
        },
      ],
    },
    {
      area: 250,
      modules_area: 0,
      pitch: 5,
      modules: false,
      edges_length: {
        eave: 100,
        hip: 0,
        rake: 50,
        ridge: 0,
        valley: 0,
      },
      faces: [
        {
          area: 250,
          modules_area: 0,
          azimuth: 25,
          pitch: 5,
          modules: false,
        },
      ],
    },
  ],
}

describe('aurora-roof-summary-mapper', () => {
  it('maps Aurora edges_length to ARX linear columns (summed across roofs)', () => {
    const mapped = mapAuroraRoofSummaryToMeasurement(AURORA_SAMPLE)

    expect(mapped.ridges_lf).toBe(100)
    expect(mapped.hips_lf).toBe(100)
    expect(mapped.valleys_lf).toBe(100)
    expect(mapped.eaves_lf).toBe(200)
    expect(mapped.rakes_lf).toBe(150)
    expect(mapped.facet_count).toBe(3)
    expect(mapped.total_area_sqft).toBe(1750)
  })

  it('maps face azimuth to compass orientation and pitch degrees to rise/12', () => {
    const mapped = mapAuroraRoofSummaryToMeasurement(AURORA_SAMPLE)
    const primary = mapped.facets[0]

    expect(primary.orientation).toBe('E')
    expect(primary.pitch_degrees).toBe(20)
    expect(primary.pitch_rise).toBeGreaterThanOrEqual(4)
    expect(primary.pitch).toMatch(/\/12$/)
  })
})
