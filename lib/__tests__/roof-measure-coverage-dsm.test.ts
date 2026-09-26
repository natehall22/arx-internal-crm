import { solarCoverageNote, SOLAR_COVERAGE_UNDER_THRESHOLD } from '@/lib/roof-measure-solar-overlap'
import { classifyEdgeFromDsmPlanes, fitFacetPlaneFromDsm } from '@/lib/roof-facet-dsm-plane'
import { splitFacetEdgesAtTJunctions } from '@/lib/roof-facet-tjunction'
import { buildSharedEdgeSet } from '@/lib/roof-measure-edge-classification'

describe('solarCoverageNote (missing-section check)', () => {
  it('flags the under-measured carrier jobs', () => {
    // flat sq ft drawn vs Google ground sq ft, from the 2026-09-26 fixture run
    expect(solarCoverageNote(554, 730)).toMatch(/smaller than Google's footprint/) // Florence 0.76
    expect(solarCoverageNote(2509, 3020)).toMatch(/about 511 sq ft may be missing/) // Peduto 0.83
    expect(solarCoverageNote(1476, 3674)).not.toBeNull() // Briarfield 0.40
  })

  it('stays quiet on correctly measured roofs (eave overhang reads over Google)', () => {
    expect(solarCoverageNote(1613, 1656)).toBeNull() // Randy Hart 0.97
    expect(solarCoverageNote(6393, 5456)).toBeNull() // Corriher 1.17
    expect(solarCoverageNote(0.9 * 2000, 2000)).toBeNull()
  })

  it('ignores a missing or tiny reference', () => {
    expect(solarCoverageNote(100, null)).toBeNull()
    expect(solarCoverageNote(100, 300)).toBeNull()
    expect(SOLAR_COVERAGE_UNDER_THRESHOLD).toBeLessThan(0.97)
  })
})

// A 10 m x 6 m facet near Concord; synthetic DSM = plane dropping 0.5 m per m toward the south (6/12).
const LAT = 35.4
const LNG = -80.6
const mLat = 111_320
const mLng = 111_320 * Math.cos((LAT * Math.PI) / 180)
const at = (x: number, y: number) => ({ lat: LAT + y / mLat, lng: LNG + x / mLng })
const southSlope = (lat: number) => 10 + 0.5 * (lat - LAT) * mLat

describe('fitFacetPlaneFromDsm', () => {
  const facet = [at(0, 0), at(10, 0), at(10, 6), at(0, 6)]

  it('recovers pitch and drain direction from interior samples', () => {
    const plane = fitFacetPlaneFromDsm(facet, (lat) => southSlope(lat))
    expect(plane).not.toBeNull()
    expect(plane!.pitchDegrees).toBeCloseTo(26.57, 1) // atan(0.5) = 6/12
    expect(plane!.drainAzimuthDegrees).toBeCloseTo(180, 0) // water runs south
  })

  it('shrugs off a chimney-sized outlier', () => {
    const chimney = (lat: number, lng: number) => {
      const x = (lng - LNG) * mLng
      const y = (lat - LAT) * mLat
      return southSlope(lat) + (x > 4 && x < 5 && y > 2 && y < 3 ? 1.5 : 0)
    }
    const plane = fitFacetPlaneFromDsm(facet, chimney)
    expect(plane!.pitchDegrees).toBeCloseTo(26.57, 0)
  })

  it('returns no direction for a flat roof and null with no data', () => {
    expect(fitFacetPlaneFromDsm(facet, () => 10)!.drainAzimuthDegrees).toBeNull()
    expect(fitFacetPlaneFromDsm(facet, () => null)).toBeNull()
  })
})

describe('classifyEdgeFromDsmPlanes', () => {
  // Gable: north half slopes north, south half slopes south, ridge along y = 5.
  const north = [at(0, 5), at(10, 5), at(10, 10), at(0, 10)]
  const south = [at(0, 0), at(10, 0), at(10, 5), at(0, 5)]
  const ridgeZ = (lat: number) => 10 - 0.5 * Math.abs((lat - LAT) * mLat - 5)
  const pn = fitFacetPlaneFromDsm(north, ridgeZ, { insetM: 0.6 })!
  const ps = fitFacetPlaneFromDsm(south, ridgeZ, { insetM: 0.6 })!
  const c = (pts: typeof north) => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / 4, lng: pts.reduce((s, p) => s + p.lng, 0) / 4 })

  it('reads a level convex fold as a ridge', () => {
    expect(classifyEdgeFromDsmPlanes(at(0, 5), at(10, 5), pn, c(north), ps, c(south))).toBe('ridge')
  })

  it('reads a concave fold as a valley', () => {
    const valleyZ = (lat: number) => 10 + 0.5 * Math.abs((lat - LAT) * mLat - 5)
    const vn = fitFacetPlaneFromDsm(north, valleyZ)!
    const vs = fitFacetPlaneFromDsm(south, valleyZ)!
    expect(classifyEdgeFromDsmPlanes(at(0, 5), at(10, 5), vn, c(north), vs, c(south))).toBe('valley')
  })
})

describe('splitFacetEdgesAtTJunctions', () => {
  it('turns a T-junction into a shared edge', () => {
    // Big facet's top edge runs 0→10; the small facet sits on its left half (0→5).
    const big = { id: 'big', points: [at(0, 0), at(10, 0), at(10, 4), at(0, 4)] }
    const small = { id: 'small', points: [at(0, 4), at(5, 4), at(5, 8), at(0, 8)] }
    expect(buildSharedEdgeSet([big, small]).size).toBe(0)
    const split = splitFacetEdgesAtTJunctions([big, small])
    expect(split[0].points).toHaveLength(5)
    expect(buildSharedEdgeSet(split).size).toBe(2)
  })

  it('leaves already-matching facets untouched', () => {
    const a = { id: 'a', points: [at(0, 0), at(5, 0), at(5, 5), at(0, 5)] }
    const b = { id: 'b', points: [at(5, 0), at(10, 0), at(10, 5), at(5, 5)] }
    const out = splitFacetEdgesAtTJunctions([a, b])
    expect(out[0]).toBe(a)
    expect(out[1]).toBe(b)
  })
})
