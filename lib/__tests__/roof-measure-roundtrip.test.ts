import fs from 'node:fs'
import path from 'node:path'
import { classifyRoofEdges, FacetInput } from '@/lib/roof-measure-edge-classification'
import { RoofMeasurePoint } from '@/lib/roof-measure-geometry'
import { calculateRoofWaste } from '@/lib/roof-waste-model'

type RectFacet = {
  id: string
  west: number
  south: number
  east: number
  north: number
  facing_azimuth_degrees?: number | null
  suggested_azimuth_degrees?: number | null
  solar_segment_index?: number | null
  pitch_multiplier?: number
}

type RoundtripFixture = {
  baseLat: number
  baseLng: number
  measurement: {
    facets: RectFacet[]
    manual_ridges_lf?: number
    manual_valleys_lf?: number
    total_area_sqft?: number
    total_squares?: number
  }
  expected: {
    ridges_lf: number
    hips_lf: number
    valleys_lf: number
    suggested_waste_min: number
    raw_data_facet_fields: string[]
  }
}

function loadFixture(): RoundtripFixture {
  const p = path.join(process.cwd(), 'scripts', 'roof-measure-roundtrip-fixture.json')
  return JSON.parse(fs.readFileSync(p, 'utf8')) as RoundtripFixture
}

function ft(baseLat: number, baseLng: number, northFt: number, eastFt: number): RoofMeasurePoint {
  const ftToLat = 1 / 364000
  const ftToLng = ftToLat / Math.cos((baseLat * Math.PI) / 180)
  return {
    lat: baseLat + northFt * ftToLat,
    lng: baseLng + eastFt * ftToLng,
  }
}

function toFacetInput(file: RoundtripFixture, spec: RectFacet): FacetInput {
  return {
    id: spec.id,
    points: [
      ft(file.baseLat, file.baseLng, spec.north, spec.west),
      ft(file.baseLat, file.baseLng, spec.north, spec.east),
      ft(file.baseLat, file.baseLng, spec.south, spec.east),
      ft(file.baseLat, file.baseLng, spec.south, spec.west),
    ],
    facing_azimuth_degrees: spec.facing_azimuth_degrees ?? null,
  }
}

/** Mirrors updateMeasurements → calculateRoofWaste inputs in page.tsx */
function wasteFromMeasurement(input: {
  baseSquares: number
  facetCount: number
  ridges_lf: number
  hips_lf: number
  valleys_lf: number
  avgPitchMultiplier: number
}): number {
  return calculateRoofWaste({
    baseSquares: input.baseSquares,
    facetCount: input.facetCount,
    ridges_lf: input.ridges_lf,
    hips_lf: input.hips_lf,
    valleys_lf: input.valleys_lf,
    avgPitchMultiplier: input.avgPitchMultiplier,
  }).wastePercent
}

describe('roof measure save/load roundtrip fixture', () => {
  const fixture = loadFixture()

  it('classifies LF columns and preserves solar facet fields for raw_data', () => {
    const facetInputs = fixture.measurement.facets.map((f) => toFacetInput(fixture, f))
    const geo = classifyRoofEdges(facetInputs)

    const manualRidges = fixture.measurement.manual_ridges_lf ?? 0
    const manualValleys = fixture.measurement.manual_valleys_lf ?? 0
    const ridgesLf = manualRidges > 0 ? Math.round(manualRidges) : geo.ridges_lf
    const hipsLf = geo.hips_lf
    const valleysLf = geo.valleys_lf + Math.round(manualValleys)
    const baseSquares = fixture.measurement.total_squares ?? (fixture.measurement.total_area_sqft ?? 2400) / 100
    const avgPitchMultiplier =
      fixture.measurement.facets.reduce((sum, f) => sum + (f.pitch_multiplier ?? 1), 0) /
      fixture.measurement.facets.length

    expect(ridgesLf).toBeGreaterThanOrEqual(fixture.expected.ridges_lf - 5)
    expect(ridgesLf).toBeLessThanOrEqual(fixture.expected.ridges_lf + 5)
    expect(hipsLf).toBe(fixture.expected.hips_lf)
    expect(valleysLf).toBe(fixture.expected.valleys_lf)

    const rawPayload = {
      ...fixture.measurement,
      facets: fixture.measurement.facets.map((f) => ({
        ...f,
        points: toFacetInput(fixture, f).points,
      })),
      ridges_lf: ridgesLf,
      hips_lf: hipsLf,
      valleys_lf: valleysLf,
    }

    for (const field of fixture.expected.raw_data_facet_fields) {
      for (const facet of rawPayload.facets) {
        expect(facet).toHaveProperty(field)
        expect((facet as Record<string, unknown>)[field]).not.toBeUndefined()
      }
    }

    const waste = wasteFromMeasurement({
      baseSquares,
      facetCount: facetInputs.length,
      ridges_lf: ridgesLf,
      hips_lf: hipsLf,
      valleys_lf: valleysLf,
      avgPitchMultiplier,
    })
    expect(waste).toBeGreaterThanOrEqual(fixture.expected.suggested_waste_min)
  })

  it('uses live hips/valleys for waste (not zeroed legacy path)', () => {
    const facetInputs = fixture.measurement.facets.map((f) => toFacetInput(fixture, f))
    const geo = classifyRoofEdges(facetInputs)
    const withGeo = wasteFromMeasurement({
      baseSquares: 24,
      facetCount: facetInputs.length,
      ridges_lf: geo.ridges_lf,
      hips_lf: geo.hips_lf,
      valleys_lf: geo.valleys_lf,
      avgPitchMultiplier: 1.118,
    })
    const zeroed = wasteFromMeasurement({
      baseSquares: 24,
      facetCount: facetInputs.length,
      ridges_lf: geo.ridges_lf,
      hips_lf: 0,
      valleys_lf: 0,
      avgPitchMultiplier: 1.118,
    })
    expect(withGeo).toBeGreaterThanOrEqual(zeroed)
  })
})
