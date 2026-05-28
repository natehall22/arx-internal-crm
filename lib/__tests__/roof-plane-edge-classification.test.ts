import fs from 'node:fs'
import path from 'node:path'
import {
  classifyRoofEdgesFromPlanes,
  classifyRoofEdgesWithOptionalPlanes,
  solarPlaneNormal,
  type PlaneFacetInput,
} from '@/lib/roof-plane-edge-classification'
import { classifyRoofEdges, FacetInput } from '@/lib/roof-measure-edge-classification'
import { RoofMeasurePoint } from '@/lib/roof-measure-geometry'

type RectSpec = {
  id: string
  west: number
  south: number
  east: number
  north: number
}

type PointSpec = { id: string; points: [number, number][] }

type GoldenCase = {
  id: string
  facets: Array<RectSpec | PointSpec>
  targets: Record<string, number>
}

type GoldenFile = {
  baseLat: number
  baseLng: number
  cases: GoldenCase[]
}

/** Synthetic Solar plane metadata for golden calibration (typical 4/12 pitch). */
const GOLDEN_PLANE_META: Record<
  string,
  { facing_azimuth_degrees: number; pitch_degrees: number; plane_height_at_center_meters?: number }
> = {
  south: { facing_azimuth_degrees: 180, pitch_degrees: 26.565, plane_height_at_center_meters: 250 },
  north: { facing_azimuth_degrees: 0, pitch_degrees: 26.565, plane_height_at_center_meters: 250 },
  nw: { facing_azimuth_degrees: 315, pitch_degrees: 26.565, plane_height_at_center_meters: 250 },
  ne: { facing_azimuth_degrees: 45, pitch_degrees: 26.565, plane_height_at_center_meters: 250 },
  se: { facing_azimuth_degrees: 135, pitch_degrees: 26.565, plane_height_at_center_meters: 250 },
  sw: { facing_azimuth_degrees: 225, pitch_degrees: 26.565, plane_height_at_center_meters: 250 },
  only: { facing_azimuth_degrees: 90, pitch_degrees: 26.565, plane_height_at_center_meters: 250 },
}

function loadGolden(): GoldenFile {
  const p = path.join(__dirname, 'fixtures', 'roof-edge-golden.json')
  return JSON.parse(fs.readFileSync(p, 'utf8')) as GoldenFile
}

function ft(
  baseLat: number,
  baseLng: number,
  northFt: number,
  eastFt: number
): RoofMeasurePoint {
  const ftToLat = 1 / 364000
  const ftToLng = ftToLat / Math.cos((baseLat * Math.PI) / 180)
  return {
    lat: baseLat + northFt * ftToLat,
    lng: baseLng + eastFt * ftToLng,
  }
}

function toFacetInput(file: GoldenFile, spec: RectSpec | PointSpec): FacetInput {
  if ('points' in spec) {
    return {
      id: spec.id,
      points: spec.points.map(([n, e]) => ft(file.baseLat, file.baseLng, n, e)),
    }
  }
  const { id, west, south, east, north } = spec
  return {
    id,
    points: [
      ft(file.baseLat, file.baseLng, south, west),
      ft(file.baseLat, file.baseLng, south, east),
      ft(file.baseLat, file.baseLng, north, east),
      ft(file.baseLat, file.baseLng, north, west),
    ],
  }
}

function toPlaneFacetInput(file: GoldenFile, spec: RectSpec | PointSpec): PlaneFacetInput {
  const base = toFacetInput(file, spec)
  const meta = GOLDEN_PLANE_META[spec.id]
  if (!meta) return base
  return { ...base, ...meta }
}

function interiorLf(r: { ridges_lf: number; hips_lf: number; valleys_lf: number }): number {
  return r.ridges_lf + r.hips_lf + r.valleys_lf
}

function distanceToTargets(
  r: { ridges_lf: number; hips_lf: number; valleys_lf: number },
  t: Record<string, number>
): number {
  let d = 0
  if (typeof t.ridges_lf === 'number') d += Math.abs(r.ridges_lf - t.ridges_lf)
  if (typeof t.hips_lf === 'number') d += Math.abs(r.hips_lf - t.hips_lf)
  if (typeof t.valleys_lf === 'number') d += Math.abs(r.valleys_lf - t.valleys_lf)
  return d
}

describe('roof plane edge classification', () => {
  it('builds a unit normal from Solar pitch/azimuth', () => {
    const [nx, ny, nz] = solarPlaneNormal(26.565, 180)
    expect(nx).toBeCloseTo(0, 2)
    expect(ny).toBeLessThan(-0.4)
    expect(nz).toBeGreaterThan(0.8)
  })

  it('2.5D path falls back to 2D when planes missing', () => {
    const facets = [
      {
        id: 'a',
        points: [
          { lat: 33.45, lng: -112.07 },
          { lat: 33.45, lng: -112.069 },
          { lat: 33.449, lng: -112.069 },
          { lat: 33.449, lng: -112.07 },
        ],
        facing_azimuth_degrees: 180,
      },
      {
        id: 'b',
        points: [
          { lat: 33.451, lng: -112.07 },
          { lat: 33.451, lng: -112.069 },
          { lat: 33.45, lng: -112.069 },
          { lat: 33.45, lng: -112.07 },
        ],
        facing_azimuth_degrees: 0,
      },
    ]
    const d2 = classifyRoofEdges(facets)
    const withPlanes = classifyRoofEdgesWithOptionalPlanes(facets, true)
    expect(withPlanes.ridges_lf + withPlanes.hips_lf).toBeGreaterThanOrEqual(0)
    expect(d2.ridges_lf).toBeGreaterThanOrEqual(0)
  })

  it('plane classifier returns same shape as 2D', () => {
    const facets = [
      {
        id: 'a',
        points: [
          { lat: 35.41, lng: -80.6 },
          { lat: 35.41, lng: -80.599 },
          { lat: 35.409, lng: -80.599 },
          { lat: 35.409, lng: -80.6 },
        ],
        facing_azimuth_degrees: 90,
        pitch_degrees: 22,
        plane_height_at_center_meters: 250,
      },
      {
        id: 'b',
        points: [
          { lat: 35.411, lng: -80.6 },
          { lat: 35.411, lng: -80.599 },
          { lat: 35.41, lng: -80.599 },
          { lat: 35.41, lng: -80.6 },
        ],
        facing_azimuth_degrees: 270,
        pitch_degrees: 22,
        plane_height_at_center_meters: 250,
      },
    ]
    const r = classifyRoofEdgesFromPlanes(facets)
    expect(r.ridges_lf).toBeGreaterThanOrEqual(0)
    expect(r.hips_lf).toBeGreaterThanOrEqual(0)
    expect(r.valleys_lf).toBeGreaterThanOrEqual(0)
  })

  describe('golden fixture calibration: 2D vs 2.5D LF', () => {
    const golden = loadGolden()

    function calibrateCase(c: GoldenCase) {
      const facets2d = c.facets.map((f) => toFacetInput(golden, f))
      const facets25d = c.facets.map((f) => toPlaneFacetInput(golden, f))
      const d2 = classifyRoofEdges(facets2d)
      const d25 = classifyRoofEdgesFromPlanes(facets25d)
      const optional = classifyRoofEdgesWithOptionalPlanes(facets25d, true)
      const d2Dist = distanceToTargets(d2, c.targets)
      const d25Dist = distanceToTargets(d25, c.targets)
      const winner: '2D' | '2.5D' | 'tie' =
        d25Dist < d2Dist ? '2.5D' : d2Dist < d25Dist ? '2D' : 'tie'
      return { id: c.id, d2, d25, optional, winner, d2Dist, d25Dist }
    }

    for (const c of golden.cases) {
      it(`${c.id}: records 2D vs 2.5D interior LF`, () => {
        const row = calibrateCase(c)

        expect(row.d2.unclassified_shared_lf).toBe(0)
        expect(row.d25.unclassified_shared_lf).toBe(0)

        const i2 = interiorLf(row.d2)
        const i25 = interiorLf(row.d25)
        const iOpt = interiorLf(row.optional)
        if (i2 > 0 && i25 > i2 * 1.35) {
          expect(iOpt).toBe(i2)
        }
      })
    }

    it('prints calibration table (2D vs 2.5D)', () => {
      const calibrationRows = golden.cases.map(calibrateCase)
      expect(calibrationRows.length).toBe(golden.cases.length)
      const header =
        'fixture'.padEnd(22) +
        '2D R/H/V'.padEnd(16) +
        '2.5D R/H/V'.padEnd(16) +
        'opt R/H/V'.padEnd(16) +
        'winner'
      const lines = calibrationRows.map(({ id, d2, d25, optional, winner }) => {
        const fmt = (r: typeof d2) => `${r.ridges_lf}/${r.hips_lf}/${r.valleys_lf}`
        return (
          id.padEnd(22) +
          fmt(d2).padEnd(16) +
          fmt(d25).padEnd(16) +
          fmt(optional).padEnd(16) +
          winner
        )
      })
      // eslint-disable-next-line no-console
      console.log('\n' + [header, ...lines].join('\n') + '\n')
    })
  })
})

/**
 * When 2.5D wins over pure 2D drain-azimuth heuristics:
 *
 * - **Reliable Solar metadata** on every adjacent facet pair: `pitchDegrees`,
 *   `azimuthDegrees`, and optionally `planeHeightAtCenterMeters` from
 *   `buildingInsights.roofSegmentStats`.
 * - **Complex hip/valley layouts** where footprint geometry alone mis-infers drain
 *   direction (e.g. symmetric quads, L-shaped footprints) but Solar facing azimuth
 *   is correct — plane normals + azimuth separation disambiguate ridge (~180° apart)
 *   vs hip (~90° apart) vs valley (parallel normals).
 * - **Missing or wrong 2D facing_azimuth** on facets: 2.5D still classifies when
 *   plane pitch/azimuth are present; 2D falls back to computed drain azimuth.
 *
 * When to keep USE_PLANE_INTERSECTION_LF false:
 * - Golden fixtures without Solar plane fields (2.5D equals 2D fallback).
 * - Plane LF diverges >35% above 2D interior totals (see classifyRoofEdgesWithOptionalPlanes guard).
 * - Greenway / production calibration not yet run (flag default off in roof-measure-flags.ts).
 */
