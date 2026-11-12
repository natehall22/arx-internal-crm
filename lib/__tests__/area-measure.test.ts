/** @jest-environment node */
/**
 * Measure yard rules: unit conversion, cut-out subtraction, totals per type, mulch and pine straw estimates, company
 * settings, what the save route accepts, and measurement history. Pure — no Google, no database.
 */
import fs from 'fs'
import path from 'path'

import {
  AREA_LIMITS,
  AREA_MEASURE_DEFAULTS,
  EARTH_RADIUS_M,
  bedMaterials,
  computeTotals,
  distanceMeters,
  formatAcres,
  formatCuYd,
  formatSqft,
  groupMeasurementHistory,
  mulchCubicYards,
  parseAreaMeasureSettingsPatch,
  parseShapesInput,
  pathLengthFeet,
  pathLengthMeters,
  pineStrawBales,
  polygonAreaSqft,
  polygonAreaSqm,
  polygonSelfIntersects,
  resolveAreaMeasureSettings,
  shapeLabel,
  sqftToAcres,
  sqmToSqft,
  type AreaShape,
} from '@/lib/area-measure'
import { isAreaMeasureNotReady } from '@/lib/area-measure-db'

const sq = (id: string, type: AreaShape['type'], sqft: number, extra: Partial<AreaShape> = {}): AreaShape => ({
  id,
  type,
  name: null,
  points: [{ lat: 30, lng: -84 }, { lat: 30, lng: -83.999 }, { lat: 30.001, lng: -83.999 }],
  sqft,
  ...extra,
})
const line = (id: string, feet: number): AreaShape => ({ id, type: 'line', name: null, points: [{ lat: 30, lng: -84 }, { lat: 30, lng: -83.999 }], feet })

describe('units', () => {
  it('square metres to square feet and acres', () => {
    expect(sqmToSqft(1)).toBeCloseTo(10.7639, 4)
    expect(sqmToSqft(4046.8564224)).toBeCloseTo(43560, 0)
    expect(sqftToAcres(43560)).toBe(1)
    expect(sqftToAcres(21780)).toBe(0.5)
  })
  it('formats for the screen', () => {
    expect(formatSqft(12345.6)).toBe('12,346 sq ft')
    expect(formatAcres(12345.6)).toBe('0.28 ac')
    expect(formatAcres(2000)).toBe('0.046 ac')
    expect(formatCuYd(4.6296)).toBe('4.63 cu yd')
  })
})

describe('materials ("est.")', () => {
  it('mulch: 108 sq ft at 3 in is exactly one cubic yard', () => {
    expect(mulchCubicYards(108, 3)).toBe(1)
    expect(mulchCubicYards(500, 3)).toBe(4.63)
    expect(mulchCubicYards(500, 4)).toBe(6.17)
    expect(mulchCubicYards(1000, 2)).toBe(6.17)
  })
  it('mulch: nothing to cover or no depth is 0, never NaN or negative', () => {
    expect(mulchCubicYards(0, 3)).toBe(0)
    expect(mulchCubicYards(-5, 3)).toBe(0)
    expect(mulchCubicYards(500, 0)).toBe(0)
    expect(mulchCubicYards(NaN, 3)).toBe(0)
  })
  it('pine straw: whole bales, rounded UP, exact fits are not bumped by float noise', () => {
    expect(pineStrawBales(100, 50)).toBe(2)
    expect(pineStrawBales(101, 50)).toBe(3)
    expect(pineStrawBales(1, 50)).toBe(1)
    expect(pineStrawBales(300, 35)).toBe(9)
    expect(pineStrawBales(0, 50)).toBe(0)
    expect(pineStrawBales(500, 0)).toBe(0)
  })
  it('uses the company numbers, not constants', () => {
    expect(bedMaterials(540, { mulchDepthIn: 3, strawSqftPerBale: 50 })).toEqual({ mulchCuYd: 5, strawBales: 11 })
    expect(bedMaterials(540, { mulchDepthIn: 2, strawSqftPerBale: 30 })).toEqual({ mulchCuYd: 3.33, strawBales: 18 })
  })
})

describe('totals and cut-outs', () => {
  it('sums lawn, beds and lines separately; counts shapes', () => {
    const t = computeTotals([sq('a', 'lawn', 10000), sq('b', 'lawn', 5000), sq('c', 'bed', 800), line('d', 120), line('e', 80.5)])
    expect(t.lawnSqft).toBe(15000)
    expect(t.bedSqft).toBe(800)
    expect(t.lineFeet).toBe(200.5)
    expect(t.counts).toEqual({ lawn: 2, bed: 1, cutout: 0, line: 2 })
    expect(t.cutoutSqft).toBe(0)
  })
  it('a cut-out comes out of the lawn total by default', () => {
    const t = computeTotals([sq('a', 'lawn', 10000), sq('house', 'cutout', 2500)])
    expect(t.lawnGrossSqft).toBe(10000)
    expect(t.lawnSqft).toBe(7500)
    expect(t.cutoutLawnSqft).toBe(2500)
    expect(t.bedSqft).toBe(0)
  })
  it('a cut-out can come out of the beds instead (a pool in a bed area)', () => {
    const t = computeTotals([sq('a', 'lawn', 10000), sq('b', 'bed', 1000), sq('pool', 'cutout', 300, { takesFrom: 'bed' })])
    expect(t.lawnSqft).toBe(10000)
    expect(t.bedSqft).toBe(700)
    expect(t.cutoutBedSqft).toBe(300)
    expect(t.cutoutSqft).toBe(300)
  })
  it('several cut-outs add up; the net never goes below zero', () => {
    const t = computeTotals([sq('a', 'lawn', 1000), sq('h', 'cutout', 800), sq('d', 'cutout', 700)])
    expect(t.lawnSqft).toBe(0)
    expect(t.cutoutSqft).toBe(1500)
    const none = computeTotals([sq('h', 'cutout', 800)])
    expect(none.lawnSqft).toBe(0)
  })
  it('bed materials are worked from the NET bed area', () => {
    const t = computeTotals([sq('b', 'bed', 1080), sq('c', 'cutout', 540, { takesFrom: 'bed' })], { mulchDepthIn: 3, strawSqftPerBale: 50 })
    expect(t.bedSqft).toBe(540)
    expect(t.materials).toEqual({ mulchCuYd: 5, strawBales: 11, mulchDepthIn: 3, strawSqftPerBale: 50 })
  })
  it('acres follow the net area; empty list is all zeros', () => {
    expect(computeTotals([sq('a', 'lawn', 43560)]).lawnAcres).toBe(1)
    const z = computeTotals([])
    expect([z.lawnSqft, z.bedSqft, z.lineFeet, z.materials.mulchCuYd, z.materials.strawBales]).toEqual([0, 0, 0, 0, 0])
  })
  it('junk measured values count as 0, never NaN', () => {
    const t = computeTotals([sq('a', 'lawn', NaN as number), sq('b', 'lawn', -5), { ...sq('c', 'lawn', 0), sqft: undefined }])
    expect(t.lawnSqft).toBe(0)
  })
  it('default names count per type', () => {
    const a = sq('a', 'lawn', 1)
    const b = sq('b', 'lawn', 1)
    const c = sq('c', 'bed', 1, { name: ' Rose bed ' })
    expect([shapeLabel(a, [a, b, c]), shapeLabel(b, [a, b, c]), shapeLabel(c, [a, b, c])]).toEqual(['Lawn 1', 'Lawn 2', 'Rose bed'])
  })
})

describe('company settings', () => {
  it('nothing stored = the defaults (3 in of mulch, 50 sq ft per bale)', () => {
    expect(resolveAreaMeasureSettings(undefined)).toEqual({ mulchDepthIn: 3, strawSqftPerBale: 50 })
    expect(resolveAreaMeasureSettings({})).toEqual(AREA_MEASURE_DEFAULTS)
  })
  it('stored values are used; a bad one falls back for that key only', () => {
    expect(resolveAreaMeasureSettings({ mulchDepthIn: 4, strawSqftPerBale: 35 })).toEqual({ mulchDepthIn: 4, strawSqftPerBale: 35 })
    expect(resolveAreaMeasureSettings({ mulchDepthIn: 'deep', strawSqftPerBale: 35 })).toEqual({ mulchDepthIn: 3, strawSqftPerBale: 35 })
    expect(resolveAreaMeasureSettings({ mulchDepthIn: -1, strawSqftPerBale: 9999 })).toEqual(AREA_MEASURE_DEFAULTS)
    expect(resolveAreaMeasureSettings('x')).toEqual(AREA_MEASURE_DEFAULTS)
  })
  it('a save is checked: plain-words reason, known keys only, something to save', () => {
    expect(parseAreaMeasureSettingsPatch({ mulchDepthIn: 2.5 })).toEqual({ set: { mulchDepthIn: 2.5 } })
    expect(parseAreaMeasureSettingsPatch({ mulchDepthIn: 2, strawSqftPerBale: 40 })).toEqual({ set: { mulchDepthIn: 2, strawSqftPerBale: 40 } })
    expect(parseAreaMeasureSettingsPatch({ mulchDepthIn: 0 })).toEqual({ error: 'Mulch depth (inches) must be a number from 0.5 to 12' })
    expect(parseAreaMeasureSettingsPatch({ strawSqftPerBale: '40' })).toEqual({ error: 'Pine straw: sq ft per bale must be a number from 5 to 500' })
    expect(parseAreaMeasureSettingsPatch({ price: 1 })).toEqual({ error: 'Unknown setting: price' })
    expect(parseAreaMeasureSettingsPatch({})).toEqual({ error: 'Nothing to save' })
    expect(parseAreaMeasureSettingsPatch(null)).toEqual({ error: 'Nothing to save' })
  })
  it('the defaults live in lib/area-measure.ts only — no other file of the tool types them in', () => {
    const root = path.resolve(__dirname, '..', '..')
    const files = [
      'components/area-measure/AreaMeasureClient.tsx',
      'components/area-measure/YardMeasureCard.tsx',
      'components/area-measure/LeadYardMeasure.tsx',
      'lib/area-measure-db.ts',
      'app/api/area-measure/route.ts',
      'app/api/area-measure/settings/route.ts',
      'app/tools/area-measure/page.tsx',
    ]
    for (const f of files) expect([f, /\b(mulchDepthIn|strawSqftPerBale)\s*[:=]\s*\d/.test(fs.readFileSync(path.join(root, f), 'utf8'))]).toEqual([f, false])
  })
})

describe('geodesic measuring (port of Google computeArea / computeLength)', () => {
  const FT = 0.3048 / 111_320
  const rect = (lat: number, lng: number, wFt: number, hFt: number) => [
    { lat, lng },
    { lat, lng: lng + (wFt * FT) / Math.cos((lat * Math.PI) / 180) },
    { lat: lat + hFt * FT, lng: lng + (wFt * FT) / Math.cos((lat * Math.PI) / 180) },
    { lat: lat + hFt * FT, lng },
  ]
  it('a 100 x 100 ft yard is about 10,000 sq ft, in either winding direction', () => {
    const r = rect(30.1, -84.2, 100, 100)
    expect(polygonAreaSqft(r)).toBeGreaterThan(9990)
    expect(polygonAreaSqft(r)).toBeLessThan(10010)
    expect(polygonAreaSqft([...r].reverse())).toBeCloseTo(polygonAreaSqft(r), 6)
  })
  it('agrees with the exact sphere formula for a small lat/lng box (R^2 x d-lng x d-sin(lat), R = 6378137 m)', () => {
    const box = [{ lat: 30, lng: -84 }, { lat: 30, lng: -83.999 }, { lat: 30.001, lng: -83.999 }, { lat: 30.001, lng: -84 }]
    const exact = EARTH_RADIUS_M ** 2 * ((0.001 * Math.PI) / 180) * (Math.sin((30.001 * Math.PI) / 180) - Math.sin((30 * Math.PI) / 180))
    expect(Math.abs(polygonAreaSqm(box) - exact) / exact).toBeLessThan(0.0005)
  })
  it('lengths: one degree of latitude on the sphere, and a 120 ft line', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo((Math.PI / 180) * EARTH_RADIUS_M, 3)
    expect(pathLengthFeet([{ lat: 30.1, lng: -84.2 }, { lat: 30.1 + 120 * FT, lng: -84.2 }])).toBeCloseTo(120, 0)
    expect(pathLengthMeters([{ lat: 1, lng: 1 }])).toBe(0)
    expect(polygonAreaSqm([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).toBe(0)
  })
})

describe('self-crossing outlines', () => {
  const sq = [{ lat: 30.1, lng: -84.2 }, { lat: 30.1, lng: -84.199 }, { lat: 30.101, lng: -84.199 }, { lat: 30.101, lng: -84.2 }]
  it('a plain outline and a triangle do not cross; a bow-tie does', () => {
    expect(polygonSelfIntersects(sq)).toBe(false)
    expect(polygonSelfIntersects(sq.slice(0, 3))).toBe(false)
    expect(polygonSelfIntersects([sq[0], sq[2], sq[1], sq[3]])).toBe(true)
  })
  it('an L-shaped (concave) yard is fine; a spike that touches another edge is not', () => {
    const l = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 1, lng: 2 }, { lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 0 }].map((p) => ({ lat: 30 + p.lat * 0.0003, lng: -84 + p.lng * 0.0003 }))
    expect(polygonSelfIntersects(l)).toBe(false)
    const touching = [...l.slice(0, 5), { lat: 30, lng: -84 + 0.0003 }, ...l.slice(5)]
    expect(polygonSelfIntersects(touching)).toBe(true)
  })
})

describe('what the save accepts', () => {
  const FT = 0.3048 / 111_320
  const r7 = (n: number) => Math.round(n * 1e7) / 1e7 // points are stored to 7 decimals
  const pts = [{ lat: 30.1, lng: -84.2 }, { lat: 30.1, lng: -84.2 + 100 * FT * 1.155 }, { lat: 30.1 + 100 * FT, lng: -84.2 + 100 * FT * 1.155 }, { lat: 30.1 + 100 * FT, lng: -84.2 }].map((p) => ({ lat: r7(p.lat), lng: r7(p.lng) }))
  const area = polygonAreaSqft(pts)
  const r1 = (n: number) => Math.round(n * 10) / 10
  const linePts = pts.slice(0, 2)
  const good = { id: 'abc', type: 'lawn', name: '  Front  ', points: pts, sqft: area }

  it('a good list is cleaned: name trimmed, the SERVER measures, cut-outs default to the lawn', () => {
    const r = parseShapesInput([good, { type: 'cutout', points: pts, sqft: area * 1.01 }, { type: 'line', points: linePts, feet: pathLengthFeet(linePts) }])
    expect('shapes' in r && r.shapes).toEqual([
      { id: 'abc', type: 'lawn', name: 'Front', points: pts, sqft: r1(area) },
      { id: 's2', type: 'cutout', name: null, points: pts, sqft: r1(area), takesFrom: 'lawn' },
      { id: 's3', type: 'line', name: null, points: linePts, feet: r1(pathLengthFeet(linePts)) },
    ])
  })
  it('the browser value is optional; when present it must be within 2% (or 1 unit on a tiny shape)', () => {
    const { sqft: _s, ...none } = good
    expect(parseShapesInput([none])).toMatchObject({ shapes: [{ sqft: r1(area) }] })
    expect(parseShapesInput([{ ...good, sqft: area * 1.019 }])).toHaveProperty('shapes')
    expect(parseShapesInput([{ ...good, sqft: area * 1.021 }])).toEqual({ error: 'Shape 1: the area does not match the outline, measure it again' })
    expect(parseShapesInput([{ ...good, sqft: area * 0.97 }])).toEqual({ error: 'Shape 1: the area does not match the outline, measure it again' })
    expect(parseShapesInput([{ type: 'line', points: linePts, feet: pathLengthFeet(linePts) * 1.05 }])).toEqual({ error: 'Shape 1: the length does not match the line, measure it again' })
  })
  it('refuses an outline that crosses itself, in plain words', () => {
    expect(parseShapesInput([{ type: 'lawn', points: [pts[0], pts[2], pts[1], pts[3]] }])).toEqual({ error: 'Shape 1: Lines cross — redraw' })
  })
  it('takesFrom is kept only on cut-outs', () => {
    const r = parseShapesInput([{ ...good, takesFrom: 'bed' }, { type: 'cutout', points: pts, sqft: area, takesFrom: 'bed' }])
    expect('shapes' in r && r.shapes.map((s) => s.takesFrom)).toEqual([undefined, 'bed'])
    expect(parseShapesInput([{ type: 'cutout', points: pts, sqft: area, takesFrom: 'roof' }])).toEqual({ error: 'Shape 1: a cut-out comes out of the lawn or the beds' })
  })
  it('unsafe or repeated ids are replaced', () => {
    const r = parseShapesInput([{ ...good, id: '../x' }, { ...good, id: 'dup' }, { ...good, id: 'dup' }])
    expect('shapes' in r && r.shapes.map((s) => s.id)).toEqual(['s1', 'dup', 's3'])
  })
  it('refuses nonsense with a plain reason', () => {
    expect(parseShapesInput('x')).toEqual({ error: 'Shapes must be a list' })
    expect(parseShapesInput([])).toEqual({ error: 'Draw at least one shape first' })
    expect(parseShapesInput([{ ...good, type: 'roof' }])).toEqual({ error: 'Shape 1: unknown type' })
    expect(parseShapesInput([{ ...good, points: pts.slice(0, 2) }])).toEqual({ error: 'Shape 1: needs at least 3 points' })
    expect(parseShapesInput([{ type: 'line', points: pts.slice(0, 1), feet: 5 }])).toEqual({ error: 'Shape 1: needs at least 2 points' })
    expect(parseShapesInput([{ ...good, points: [...pts.slice(0, 2), { lat: 91, lng: 0 }] }])).toEqual({ error: 'Shape 1: a point is not a map location' })
    expect(parseShapesInput([{ ...good, points: [...pts.slice(0, 2), { lat: NaN, lng: 0 }] }])).toEqual({ error: 'Shape 1: a point is not a map location' })
    expect(parseShapesInput([{ ...good, sqft: -1 }])).toEqual({ error: 'Shape 1: the area is not a valid number' })
    expect(parseShapesInput([{ ...good, sqft: AREA_LIMITS.maxSqft + 1 }])).toEqual({ error: 'Shape 1: the area is not a valid number' })
    expect(parseShapesInput([{ ...good, sqft: 'big' }])).toEqual({ error: 'Shape 1: the area is not a valid number' })
    expect(parseShapesInput([{ type: 'line', points: linePts, feet: -3 }])).toEqual({ error: 'Shape 1: the length is not a valid number' })
    expect(parseShapesInput([{ ...good, name: 'x'.repeat(81) }])).toEqual({ error: 'Shape 1: name is too long' })
    expect(parseShapesInput([{ ...good, name: 5 }])).toEqual({ error: 'Shape 1: name must be text' })
    expect(parseShapesInput(Array.from({ length: AREA_LIMITS.maxShapes + 1 }, () => good))).toEqual({ error: `Too many shapes (most is ${AREA_LIMITS.maxShapes})` })
    expect(parseShapesInput([{ ...good, points: Array.from({ length: AREA_LIMITS.maxPointsPerShape + 1 }, () => pts[0]) }])).toEqual({ error: 'Shape 1: too many points' })
  })
})

describe('history', () => {
  const r = (id: string, property_id: string | null, created_at: string) => ({ id, property_id, created_at })
  it('newest first per property; older ones kept as history', () => {
    const g = groupMeasurementHistory([r('1', 'p1', '2026-01-01T00:00:00Z'), r('3', 'p1', '2026-03-01T00:00:00Z'), r('2', 'p2', '2026-02-01T00:00:00Z'), r('4', 'p1', '2026-02-01T00:00:00Z')])
    expect(g.map((x) => [x.propertyId, x.latest.id, x.older.map((o) => o.id)])).toEqual([
      ['p1', '3', ['4', '1']],
      ['p2', '2', []],
    ])
  })
  it('measurements with no property form their own group; empty is empty', () => {
    expect(groupMeasurementHistory([r('1', null, '2026-01-01T00:00:00Z')]).map((x) => x.propertyId)).toEqual([null])
    expect(groupMeasurementHistory([])).toEqual([])
  })
})

describe('table not there yet', () => {
  it('is recognised so screens hide and the save says so', () => {
    expect(isAreaMeasureNotReady({ code: '42P01' })).toBe(true)
    expect(isAreaMeasureNotReady({ code: 'PGRST205' })).toBe(true)
    expect(isAreaMeasureNotReady({ message: 'relation "public.area_measurements" does not exist' })).toBe(true)
    expect(isAreaMeasureNotReady({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isAreaMeasureNotReady(null)).toBe(false)
  })
})

describe('the migration keeps the delete rules the app relies on', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/202611230040_area_measurements.sql'), 'utf8')
  it('a customer with measurements cannot be deleted; lead / deal / property deletes go through triggers', () => {
    expect(sql).toMatch(/customer_id uuid NULL REFERENCES public\.customers\(id\) ON DELETE RESTRICT/)
    for (const col of ['property_id', 'opportunity_id', 'lead_id']) expect(sql).toMatch(new RegExp(`${col} uuid NULL,`))
    for (const t of ['leads', 'opportunities', 'properties']) expect(sql).toMatch(new RegExp(`BEFORE DELETE ON public\\.${t}`))
    expect(sql).toMatch(/CONSTRAINT area_measurements_has_owner CHECK/)
  })
})
