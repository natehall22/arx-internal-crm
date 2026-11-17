/**
 * Measure yard — the pure rules (no database, no Google, no React), shared by the screen, the save route and the tests.
 *
 * What a measurement is: a list of SHAPES drawn on the satellite photo. Each shape has a type —
 *   lawn    grass to mow                       (sq ft)
 *   bed     flower beds and landscaping        (sq ft; gets a mulch / pine straw estimate)
 *   cutout  a house, driveway, pool ...        (sq ft; taken OUT of the lawn total or the bed total)
 *   line    edging, fence, borders             (feet)
 * and an optional name. The screen measures each shape live with Google's `geometry.spherical.computeArea` /
 * `computeLength` (lib/google-maps-client.ts). The SERVER never trusts those numbers: it re-measures every shape from its
 * points with the JS port of the same formula below (`polygonAreaSqft`, `pathLengthFeet`), stores its own value, and
 * refuses a request whose value is more than 2% off. Totals are always `computeTotals` over the server's values.
 *
 * CUT-OUTS — cookie cutter (Nathan, 2026-11-16; reverses the earlier "subtract the whole cut-out from the total" rule): a cut-out
 * removes ONLY the part of it that overlaps the shapes of the type it "takes from" (Lawn by default, or Beds). Draw a house over the
 * edge of the lawn and only the part on the grass comes out; a cut-out entirely off the lawn removes 0.
 *   lawn_sqft = area( union(lawn shapes) - union(cut-outs taking from lawn) ), and the same for beds.
 * Overlapping lawns, overlapping beds and overlapping cut-outs never count twice (union first). `cutout_sqft` is the area actually removed.
 * The geometry is done by `polygon-clipping` (union / difference) on a flat local plane around the measurement's centroid
 * (equirectangular: fine at yard scale); every resulting polygon, holes included, is projected back and measured with the SAME
 * spherical formula as a single shape (`polygonAreaSqm`), so the screen and the server get identical totals from the same points.
 * `cookieCutter` is the one place this is computed: the totals AND the map's "lawn with a hole" fill both read it.
 * A shape whose outline crosses itself has no single area: it is left out of the geometry (the screen shows which one, and the
 * save is refused) until its points are dragged apart.
 * HISTORY: a measurement saved under the old rule keeps its stored totals (`area_measurements.totals`, never rewritten). Re-opening one
 * recomputes live with this rule; the new totals are stored only when it is saved again (as a new row).
 *
 * Every material number is an ESTIMATE ("est."): it is area x the company's depth or coverage, with no waste or overlap.
 *
 * PRICING HOOK (not built, on purpose): a price-book "size option" (e.g. mowing Small / Medium / Large lot, branch
 * feat/price-sheet) would read the plain columns `lawn_sqft` / `bed_sqft` / `line_feet` of the newest `area_measurements`
 * row for the property (`GET /api/area-measure?property_id=` returns them as `latest`). Nothing here depends on that branch.
 */
import polygonClipping from 'polygon-clipping'

export const SHAPE_TYPES = ['lawn', 'bed', 'cutout', 'line'] as const
export type ShapeType = (typeof SHAPE_TYPES)[number]
export type TakesFrom = 'lawn' | 'bed'

export const SHAPE_TYPE_LABELS: Record<ShapeType, string> = {
  lawn: 'Lawn',
  bed: 'Bed',
  cutout: 'Cut-out',
  line: 'Line',
}

/** One-line plain help under the type picker. */
export const SHAPE_TYPE_HELP: Record<ShapeType, string> = {
  lawn: 'Grass to mow',
  bed: 'Flower beds and landscaping',
  cutout: 'House, driveway, pool: only the part on the lawn or beds comes out',
  line: 'Edging, fence, borders (feet)',
}

export type LatLngPoint = { lat: number; lng: number }

export type AreaShape = {
  id: string
  type: ShapeType
  name: string | null
  points: LatLngPoint[]
  /** Polygons (lawn, bed, cut-out): square feet. */
  sqft?: number
  /** Lines: feet. */
  feet?: number
  /** Cut-outs only: which total it comes out of. */
  takesFrom?: TakesFrom
}

export const isPolygonType = (t: ShapeType): boolean => t !== 'line'
export const minPoints = (t: ShapeType): number => (isPolygonType(t) ? 3 : 2)

// ---- units ----
export const SQFT_PER_SQM = 10.763910416709722
export const FEET_PER_METER = 3.280839895013123
export const SQFT_PER_ACRE = 43560
export const CUBIC_FEET_PER_CUBIC_YARD = 27

export const sqmToSqft = (sqm: number): number => sqm * SQFT_PER_SQM
export const metersToFeet = (m: number): number => m * FEET_PER_METER
export const sqftToAcres = (sqft: number): number => sqft / SQFT_PER_ACRE

// ---- geodesic measuring (server-side port of Google's spherical.computeArea / computeLength) ----
/** Google's default radius: the WGS84 equatorial radius in metres, the sphere `computeArea` / `computeLength` use. */
export const EARTH_RADIUS_M = 6378137

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Spherical area (square metres) of a closed polygon: Google's `computeArea` (signed polar-triangle sum, absolute value). */
export function polygonAreaSqm(points: readonly LatLngPoint[], radius: number = EARTH_RADIUS_M): number {
  const n = points.length
  if (n < 3) return 0
  const polarTriangleArea = (tan1: number, lng1: number, tan2: number, lng2: number): number => {
    const deltaLng = lng1 - lng2
    const t = tan1 * tan2
    return 2 * Math.atan2(t * Math.sin(deltaLng), 1 + t * Math.cos(deltaLng))
  }
  const last = points[n - 1]
  let prevTanLat = Math.tan((Math.PI / 2 - toRad(last.lat)) / 2)
  let prevLng = toRad(last.lng)
  let total = 0
  for (const p of points) {
    const tanLat = Math.tan((Math.PI / 2 - toRad(p.lat)) / 2)
    const lng = toRad(p.lng)
    total += polarTriangleArea(tanLat, lng, prevTanLat, prevLng)
    prevTanLat = tanLat
    prevLng = lng
  }
  return Math.abs(total * radius * radius)
}

/** Great-circle distance in metres between two points: Google's `computeDistanceBetween`. */
export function distanceMeters(a: LatLngPoint, b: LatLngPoint, radius: number = EARTH_RADIUS_M): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * radius
}

/** Length in metres of an open path: Google's `computeLength`. */
export function pathLengthMeters(points: readonly LatLngPoint[], radius: number = EARTH_RADIUS_M): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i], radius)
  return total
}

export const polygonAreaSqft = (points: readonly LatLngPoint[]): number => sqmToSqft(polygonAreaSqm(points))
export const pathLengthFeet = (points: readonly LatLngPoint[]): number => metersToFeet(pathLengthMeters(points))

export const LINES_CROSS_MESSAGE = 'Lines cross — drag a point to fix it'
/** While drawing, a crossing can also be undone. */
export const LINES_CROSS_DRAFT_MESSAGE = 'Lines cross — undo the last point or drag a point to fix it'

type XY = { x: number; y: number }

/** An outline's two edges that touch or cross: edge i runs from point i to point i+1 (the last edge closes back to point 0). */
export type Crossing = { edgeA: number; edgeB: number; at: LatLngPoint }

/**
 * Every place a closed outline touches or crosses itself (a bow-tie, a figure 8). Two edges that are not neighbours may not touch.
 * Works in a flat local frame (metres around the shape), which is exact enough for a yard. A repeated point or a touching vertex
 * counts: a self-crossing outline has no single area, and Google's number for it is not the yard's. `at` is where, for the screen.
 */
export function polygonCrossings(points: readonly LatLngPoint[]): readonly Crossing[] {
  // O(n^2) per outline and asked several times for the same points (parse, cookie cutter, the screen's map / status / save checks).
  // Points arrays are never changed in place (a drag makes a new array), so the answer is kept per array.
  const hit = crossingsCache.get(points)
  if (hit) return hit
  const found = findCrossings(points)
  crossingsCache.set(points, found)
  return found
}
const crossingsCache = new WeakMap<readonly LatLngPoint[], readonly Crossing[]>()

function findCrossings(points: readonly LatLngPoint[]): Crossing[] {
  const n = points.length
  if (n < 4) return []
  const lat0 = points.reduce((a, p) => a + p.lat, 0) / n
  const kx = Math.cos(toRad(lat0)) * EARTH_RADIUS_M * (Math.PI / 180)
  const ky = EARTH_RADIUS_M * (Math.PI / 180)
  const xy: XY[] = points.map((p) => ({ x: p.lng * kx, y: p.lat * ky }))
  const orient = (a: XY, b: XY, c: XY): number => {
    const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1
  }
  const onSeg = (a: XY, b: XY, c: XY): boolean =>
    Math.min(a.x, b.x) - 1e-9 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-9
  /** Where two edges meet, or null when they do not. */
  const meet = (a: XY, b: XY, c: XY, d: XY): XY | null => {
    const o1 = orient(a, b, c)
    const o2 = orient(a, b, d)
    const o3 = orient(c, d, a)
    const o4 = orient(c, d, b)
    if (o1 !== o2 && o3 !== o4) {
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
      if (Math.abs(den) < 1e-12) return a
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
    }
    if (o1 === 0 && onSeg(a, b, c)) return c
    if (o2 === 0 && onSeg(a, b, d)) return d
    if (o3 === 0 && onSeg(c, d, a)) return a
    if (o4 === 0 && onSeg(c, d, b)) return b
    return null
  }
  const out: Crossing[] = []
  for (let i = 0; i < n; i++) {
    const a = xy[i]
    const b = xy[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      // neighbours share a vertex by design
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      const m = meet(a, b, xy[j], xy[(j + 1) % n])
      if (m) out.push({ edgeA: i, edgeB: j, at: { lat: m.y / ky, lng: m.x / kx } })
    }
  }
  return out
}

export const polygonSelfIntersects = (points: readonly LatLngPoint[]): boolean => polygonCrossings(points).length > 0

/** The browser's own number may differ from ours by rounding only: more than this fraction (or 1 sq ft / 1 ft on a tiny shape) is refused. */
export const MEASURE_TOLERANCE = 0.02

// ---- company settings (defaults live HERE, once) ----
export const AREA_MEASURE_SETTINGS_KEY = 'areaMeasure'

export type AreaMeasureSettings = {
  /** Mulch depth in inches. */
  mulchDepthIn: number
  /** Square feet one bale of pine straw covers. */
  strawSqftPerBale: number
}

export const AREA_MEASURE_DEFAULTS: Readonly<AreaMeasureSettings> = Object.freeze({
  mulchDepthIn: 3,
  strawSqftPerBale: 50,
})

/** Plain labels for the settings screen: what the owner sees, with the range we accept. */
export const AREA_MEASURE_SETTING_FIELDS = {
  mulchDepthIn: { label: 'Mulch depth (inches)', help: 'How deep you spread mulch in a bed.', min: 0.5, max: 12, step: 0.5 },
  strawSqftPerBale: { label: 'Pine straw: sq ft per bale', help: 'How much ground one bale covers.', min: 5, max: 500, step: 1 },
} as const satisfies Record<keyof AreaMeasureSettings, { label: string; help: string; min: number; max: number; step: number }>

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function inRange(v: unknown, key: keyof AreaMeasureSettings): number | null {
  const f = AREA_MEASURE_SETTING_FIELDS[key]
  return typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max ? v : null
}

/** What is stored under `orgs.settings.areaMeasure` (or nothing / junk) → a full settings object; a bad value falls back to the default. */
export function resolveAreaMeasureSettings(stored: unknown): AreaMeasureSettings {
  const o = asObject(stored)
  return {
    mulchDepthIn: inRange(o.mulchDepthIn, 'mulchDepthIn') ?? AREA_MEASURE_DEFAULTS.mulchDepthIn,
    strawSqftPerBale: inRange(o.strawSqftPerBale, 'strawSqftPerBale') ?? AREA_MEASURE_DEFAULTS.strawSqftPerBale,
  }
}

/** A save from the settings sheet: `{ mulchDepthIn?, strawSqftPerBale? }` → the keys to merge, or a plain-words reason. */
export function parseAreaMeasureSettingsPatch(body: unknown): { set: Partial<AreaMeasureSettings> } | { error: string } {
  const o = asObject(body)
  const set: Partial<AreaMeasureSettings> = {}
  for (const key of Object.keys(AREA_MEASURE_SETTING_FIELDS) as Array<keyof AreaMeasureSettings>) {
    if (!(key in o)) continue
    const f = AREA_MEASURE_SETTING_FIELDS[key]
    const v = o[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < f.min || v > f.max) return { error: `${f.label} must be a number from ${f.min} to ${f.max}` }
    set[key] = v
  }
  for (const k of Object.keys(o)) if (!(k in AREA_MEASURE_SETTING_FIELDS)) return { error: `Unknown setting: ${k}` }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

// ---- materials ("est.") ----
const round = (n: number, places: number): number => {
  const f = 10 ** places
  return Math.round((n + Number.EPSILON) * f) / f
}

/** Mulch in cubic yards for a bed area at a depth: sq ft x (inches / 12) / 27. 108 sq ft at 3 in = 1.00 cu yd. */
export function mulchCubicYards(sqft: number, depthIn: number): number {
  if (!(sqft > 0) || !(depthIn > 0)) return 0
  return round((sqft * (depthIn / 12)) / CUBIC_FEET_PER_CUBIC_YARD, 2)
}

/** Pine straw in whole bales (rounded UP: you cannot buy part of a bale). */
export function pineStrawBales(sqft: number, sqftPerBale: number): number {
  if (!(sqft > 0) || !(sqftPerBale > 0)) return 0
  return Math.ceil(round(sqft / sqftPerBale, 6))
}

export type BedMaterials = { mulchCuYd: number; strawBales: number }

export function bedMaterials(sqft: number, settings: AreaMeasureSettings): BedMaterials {
  return { mulchCuYd: mulchCubicYards(sqft, settings.mulchDepthIn), strawBales: pineStrawBales(sqft, settings.strawSqftPerBale) }
}

// ---- cookie cutter: union of lawns / beds minus union of the cut-outs that take from them ----
/** One piece of land: the outer ring first, then its holes (as `polygon-clipping` returns them: outer counter-clockwise, holes clockwise, which is what Google's Polygon `paths` wants). Rings are NOT closed (no repeated first point). */
export type Region = LatLngPoint[][]

type Pair = [number, number]
type Multi = Pair[][][]

export type CookieCutter = {
  lawnGross: Region[]
  lawnNet: Region[]
  bedGross: Region[]
  bedNet: Region[]
}

const isFilledPolygon = (s: AreaShape): boolean => isPolygonType(s.type) && s.points.length >= 3

/** Square feet of a set of regions: each outer ring minus its holes, every ring measured with the one spherical formula. */
export function regionsAreaSqft(regions: readonly Region[]): number {
  let total = 0
  for (const [outer, ...holes] of regions) {
    total += polygonAreaSqft(outer)
    for (const h of holes) total -= polygonAreaSqft(h)
  }
  return Math.max(0, total)
}

/** Shown when the clipping library cannot handle a drawing (it throws on some near-degenerate inputs). The points are kept. */
export const GEOMETRY_FAILED_MESSAGE = 'These shapes could not be measured together. Drag a point of the newest shape a little, then save again.'

/**
 * The ONE cookie-cutter computation (see the header). Shapes that cross themselves are left out until fixed.
 * May THROW (polygon-clipping does on some near-degenerate inputs): the save checks it in `parseShapesInput`, the screen catches it.
 */
export function cookieCutter(shapes: readonly AreaShape[]): CookieCutter {
  const usable = shapes.filter((s) => isFilledPolygon(s) && !polygonSelfIntersects(s.points))
  const all = usable.flatMap((s) => s.points)
  if (all.length === 0) return { lawnGross: [], lawnNet: [], bedGross: [], bedNet: [] }
  // Flat plane (metres) around the centroid of everything drawn.
  const lat0 = all.reduce((a, p) => a + p.lat, 0) / all.length
  const lng0 = all.reduce((a, p) => a + p.lng, 0) / all.length
  const ky = EARTH_RADIUS_M * (Math.PI / 180)
  const kx = Math.cos(toRad(lat0)) * ky
  const toXY = (p: LatLngPoint): Pair => [(p.lng - lng0) * kx, (p.lat - lat0) * ky]
  const toLatLng = ([x, y]: Pair): LatLngPoint => ({ lat: lat0 + y / ky, lng: lng0 + x / kx })

  const polys = (pick: (s: AreaShape) => boolean): Pair[][][] => usable.filter(pick).map((s) => [s.points.map(toXY)])
  const union = (list: Pair[][][]): Multi => {
    if (list.length === 0) return []
    const [first, ...rest] = list
    return polygonClipping.union(first, ...rest) as Multi
  }
  const minus = (a: Multi, b: Multi): Multi => (a.length === 0 || b.length === 0 ? a : (polygonClipping.difference(a, b) as Multi))
  const back = (m: Multi): Region[] => m.map((poly) => poly.map((ring) => ring.slice(0, -1).map(toLatLng)))

  const lawnGross = union(polys((s) => s.type === 'lawn'))
  const bedGross = union(polys((s) => s.type === 'bed'))
  const cutLawn = union(polys((s) => s.type === 'cutout' && s.takesFrom !== 'bed'))
  const cutBed = union(polys((s) => s.type === 'cutout' && s.takesFrom === 'bed'))
  return {
    lawnGross: back(lawnGross),
    lawnNet: back(minus(lawnGross, cutLawn)),
    bedGross: back(bedGross),
    bedNet: back(minus(bedGross, cutBed)),
  }
}

// ---- totals ----
export type AreaTotals = {
  /** The lawn shapes together (overlaps counted once), before cut-outs. */
  lawnGrossSqft: number
  /** Lawn after the parts of cut-outs that sit on it. */
  lawnSqft: number
  bedGrossSqft: number
  bedSqft: number
  /** Area actually removed from the lawn / from the beds / both (a cut-out's part off the lawn removes nothing). */
  cutoutLawnSqft: number
  cutoutBedSqft: number
  cutoutSqft: number
  lineFeet: number
  lawnAcres: number
  bedAcres: number
  counts: Record<ShapeType, number>
  /** Materials for the NET bed area, at the company's settings. */
  materials: BedMaterials & { mulchDepthIn: number; strawSqftPerBale: number }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** The ONE totals rule: the screen's live totals and the saved totals are both this function over the same shapes (their points). */
export function computeTotals(
  shapes: readonly AreaShape[],
  settings: AreaMeasureSettings = AREA_MEASURE_DEFAULTS,
  /** The screen passes the `cookieCutter(shapes)` it already has for the map, so the geometry is done once. */
  cc: CookieCutter = cookieCutter(shapes)
): AreaTotals {
  let lineFeet = 0
  const counts: Record<ShapeType, number> = { lawn: 0, bed: 0, cutout: 0, line: 0 }
  for (const s of shapes) {
    counts[s.type] += 1
    if (s.type === 'line') lineFeet += num(s.feet)
  }
  const lawnGross = regionsAreaSqft(cc.lawnGross)
  const lawn = regionsAreaSqft(cc.lawnNet)
  const bedGross = regionsAreaSqft(cc.bedGross)
  const bed = regionsAreaSqft(cc.bedNet)
  const cutLawn = Math.max(0, lawnGross - lawn)
  const cutBed = Math.max(0, bedGross - bed)
  return {
    lawnGrossSqft: round(lawnGross, 1),
    lawnSqft: round(lawn, 1),
    bedGrossSqft: round(bedGross, 1),
    bedSqft: round(bed, 1),
    cutoutLawnSqft: round(cutLawn, 1),
    cutoutBedSqft: round(cutBed, 1),
    cutoutSqft: round(cutLawn + cutBed, 1),
    lineFeet: round(lineFeet, 1),
    lawnAcres: round(sqftToAcres(lawn), 3),
    bedAcres: round(sqftToAcres(bed), 3),
    counts,
    materials: { ...bedMaterials(bed, settings), mulchDepthIn: settings.mulchDepthIn, strawSqftPerBale: settings.strawSqftPerBale },
  }
}

/** "12,345 sq ft" / "0.28 acres" for the screen. Whole square feet; acres to two places (three under 0.1). */
export function formatSqft(sqft: number): string {
  return `${Math.round(sqft).toLocaleString('en-US')} sq ft`
}
export function formatAcres(sqft: number): string {
  const a = sqftToAcres(sqft)
  return `${a.toFixed(a < 0.1 ? 3 : 2)} ac`
}
export function formatFeet(feet: number): string {
  return `${Math.round(feet).toLocaleString('en-US')} ft`
}
export function formatCuYd(n: number): string {
  return `${n.toFixed(2)} cu yd`
}

/** The default label for a shape with no name: "Lawn 2", "Cut-out 1" — counted per type in drawing order. */
export function shapeLabel(shape: AreaShape, all: readonly AreaShape[]): string {
  if (shape.name && shape.name.trim()) return shape.name.trim()
  const sameType = all.filter((s) => s.type === shape.type)
  return `${SHAPE_TYPE_LABELS[shape.type]} ${sameType.findIndex((s) => s.id === shape.id) + 1}`
}

// ---- what the save route accepts ----
export const AREA_LIMITS = {
  maxShapes: 200,
  maxPointsPerShape: 500,
  maxNameLength: 80,
  maxSqft: 435_600_000, // 10,000 acres
  maxFeet: 5_280_000, // 1,000 miles
} as const

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

/**
 * A browser's shape list → clean shapes, or the first plain-words problem. Nothing is trusted: types, names, point
 * counts, coordinate ranges and measured values are all checked; `takesFrom` is kept only on cut-outs; the id is kept
 * only when it is a safe short token. The sqft / feet are MEASURED HERE from the points (`polygonAreaSqft`, `pathLengthFeet`,
 * a port of Google's computeArea / computeLength) and the server's value is stored; the browser's value is optional and
 * refused when more than 2% off. An outline that crosses itself is refused, by name. The TOTALS are `computeTotals` over those points (cookie-cutter rule, see the header).
 */
export function parseShapesInput(input: unknown): { shapes: AreaShape[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'Shapes must be a list' }
  if (input.length === 0) return { error: 'Draw at least one shape first' }
  if (input.length > AREA_LIMITS.maxShapes) return { error: `Too many shapes (most is ${AREA_LIMITS.maxShapes})` }
  const out: AreaShape[] = []
  const seen = new Set<string>()
  for (let i = 0; i < input.length; i++) {
    const raw = asObject(input[i])
    const type = raw.type
    if (typeof type !== 'string' || !(SHAPE_TYPES as readonly string[]).includes(type)) return { error: `Shape ${i + 1}: unknown type` }
    const t = type as ShapeType
    const pts = raw.points
    if (!Array.isArray(pts) || pts.length < minPoints(t)) return { error: `Shape ${i + 1}: needs at least ${minPoints(t)} points` }
    if (pts.length > AREA_LIMITS.maxPointsPerShape) return { error: `Shape ${i + 1}: too many points` }
    const points: LatLngPoint[] = []
    for (const p of pts) {
      const o = asObject(p)
      const lat = o.lat
      const lng = o.lng
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return { error: `Shape ${i + 1}: a point is not a map location` }
      }
      points.push({ lat: round(lat, 7), lng: round(lng, 7) })
    }
    let name: string | null = null
    if (raw.name !== undefined && raw.name !== null) {
      if (typeof raw.name !== 'string') return { error: `Shape ${i + 1}: name must be text` }
      const trimmed = raw.name.trim()
      if (trimmed.length > AREA_LIMITS.maxNameLength) return { error: `Shape ${i + 1}: name is too long` }
      name = trimmed || null
    }
    const shape: AreaShape = { id: typeof raw.id === 'string' && ID_PATTERN.test(raw.id) && !seen.has(raw.id) ? raw.id : `s${i + 1}`, type: t, name, points }
    seen.add(shape.id)
    if (isPolygonType(t)) {
      if (polygonSelfIntersects(points)) {
        const nth = input.slice(0, i + 1).filter((x) => asObject(x).type === t).length
        return { error: `${name || `${SHAPE_TYPE_LABELS[t]} ${nth}`} (shape ${i + 1}): ${LINES_CROSS_MESSAGE}. Nothing was lost: drag its points on the map, then save again.` }
      }
      // The SERVER's measurement is the one stored. The browser's (Google's) is optional and only checked against it.
      const serverSqft = polygonAreaSqft(points)
      if (serverSqft > AREA_LIMITS.maxSqft) return { error: `Shape ${i + 1}: the area is not a valid number` }
      if (raw.sqft !== undefined && raw.sqft !== null) {
        const sqft = raw.sqft
        if (typeof sqft !== 'number' || !Number.isFinite(sqft) || sqft < 0 || sqft > AREA_LIMITS.maxSqft) return { error: `Shape ${i + 1}: the area is not a valid number` }
        if (Math.abs(sqft - serverSqft) > Math.max(serverSqft * MEASURE_TOLERANCE, 1)) return { error: `Shape ${i + 1}: the area does not match the outline, measure it again` }
      }
      shape.sqft = round(serverSqft, 1)
      if (t === 'cutout') {
        if (raw.takesFrom !== undefined && raw.takesFrom !== 'lawn' && raw.takesFrom !== 'bed') return { error: `Shape ${i + 1}: a cut-out comes out of the lawn or the beds` }
        shape.takesFrom = raw.takesFrom === 'bed' ? 'bed' : 'lawn'
      }
    } else {
      const serverFeet = pathLengthFeet(points)
      if (serverFeet > AREA_LIMITS.maxFeet) return { error: `Shape ${i + 1}: the length is not a valid number` }
      if (raw.feet !== undefined && raw.feet !== null) {
        const feet = raw.feet
        if (typeof feet !== 'number' || !Number.isFinite(feet) || feet < 0 || feet > AREA_LIMITS.maxFeet) return { error: `Shape ${i + 1}: the length is not a valid number` }
        if (Math.abs(feet - serverFeet) > Math.max(serverFeet * MEASURE_TOLERANCE, 1)) return { error: `Shape ${i + 1}: the length does not match the line, measure it again` }
      }
      shape.feet = round(serverFeet, 1)
    }
    out.push(shape)
  }
  // The totals are clipped geometry: a drawing the library cannot clip is refused here with a clear message, never a 500 at save.
  try {
    cookieCutter(out)
  } catch {
    return { error: GEOMETRY_FAILED_MESSAGE }
  }
  return { shapes: out }
}

// ---- history ----
export type MeasurementLike = { id: string; property_id: string | null; created_at: string }

/**
 * Newest first per property: `[{ propertyId, latest, older[] }]`, the property groups ordered by their newest
 * measurement. Rows are never overwritten (Re-measure adds a row), so "the measurement" is the newest of its group.
 */
export function groupMeasurementHistory<T extends MeasurementLike>(rows: readonly T[]): Array<{ propertyId: string | null; latest: T; older: T[] }> {
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1))
  const groups = new Map<string | null, T[]>()
  for (const r of sorted) {
    const g = groups.get(r.property_id) ?? []
    g.push(r)
    groups.set(r.property_id, g)
  }
  return Array.from(groups, ([propertyId, list]) => ({ propertyId, latest: list[0], older: list.slice(1) }))
}
