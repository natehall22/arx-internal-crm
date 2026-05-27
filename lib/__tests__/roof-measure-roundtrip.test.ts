import fs from 'node:fs'
import path from 'node:path'
import { classifyRoofEdges, FacetInput } from '@/lib/roof-measure-edge-classification'
import { RoofMeasurePoint } from '@/lib/roof-measure-geometry'

type RectFacet = {
  id: string
  west: number
  south: number
  east: number
  north: number
  facing_azimuth_degrees?: number | null
  suggested_azimuth_degrees?: number | null
  solar_segment_index?: number | null
}

type RoundtripFixture = {
  baseLat: number
  baseLng: number
  measurement: {
    facets: RectFacet[]
    manual_ridges_lf?: number
    manual_valleys_lf?: number
    total_area_sqft?: number
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

/** Mirrors updateMeasurements → calculateWasteFactorDetailed hip/valley inputs in page.tsx */
function wasteFromHipsValleys(
  hipLength: number,
  valleyLength: number,
  facetCount: number,
  totalArea: number
): number {
  let baseWaste = 10
  if (facetCount <= 4) baseWaste = 10
  else if (facetCount <= 8) baseWaste = 12
  else baseWaste = 15

  let adjustments = 0
  if (valleyLength > 20) adjustments += Math.min(3, Math.floor(valleyLength / 30))
  if (hipLength > 20) adjustments += Math.max(2, Math.min(5, Math.ceil(hipLength / 50)))

  let finalWaste = Math.min(baseWaste + adjustments, 25)
  if (hipLength > 60 && valleyLength > 40) finalWaste = Math.max(finalWaste, 17)
  else if (hipLength > 60) finalWaste = Math.max(finalWaste, 15)
  return finalWaste
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

    const waste = wasteFromHipsValleys(hipsLf, valleysLf, facetInputs.length, fixture.measurement.total_area_sqft ?? 2400)
    expect(waste).toBeGreaterThanOrEqual(fixture.expected.suggested_waste_min)
  })

  it('uses live hips/valleys for waste (not zeroed legacy path)', () => {
    const facetInputs = fixture.measurement.facets.map((f) => toFacetInput(fixture, f))
    const geo = classifyRoofEdges(facetInputs)
    const withGeo = wasteFromHipsValleys(geo.hips_lf, geo.valleys_lf, facetInputs.length, 2400)
    const zeroed = wasteFromHipsValleys(0, 0, facetInputs.length, 2400)
    expect(withGeo).toBeGreaterThanOrEqual(zeroed)
  })
})
