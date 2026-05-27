import fs from 'node:fs'
import path from 'node:path'
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

describe('roof-edge-golden fixtures', () => {
  const golden = loadGolden()

  for (const c of golden.cases) {
    it(c.id, () => {
      const facets = c.facets.map((f) => toFacetInput(golden, f))
      const r = classifyRoofEdges(facets)
      const t = c.targets

      if (typeof t.ridges_lf === 'number') {
        expect(r.ridges_lf).toBeGreaterThanOrEqual(t.ridges_lf - 5)
        expect(r.ridges_lf).toBeLessThanOrEqual(t.ridges_lf + 5)
      }
      if (typeof t.hips_lf === 'number') expect(r.hips_lf).toBe(t.hips_lf)
      if (typeof t.valleys_lf === 'number') expect(r.valleys_lf).toBe(t.valleys_lf)
      if (typeof t.interior_lf_min === 'number') {
        expect(r.ridges_lf + r.hips_lf + r.valleys_lf).toBeGreaterThanOrEqual(t.interior_lf_min)
      }
      if (typeof t.hips_lf_min === 'number') {
        expect(r.hips_lf).toBeGreaterThanOrEqual(t.hips_lf_min)
      }
      expect(r.unclassified_shared_lf).toBe(0)
    })
  }
})
