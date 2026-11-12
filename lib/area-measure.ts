/**
 * Measure yard — the pure rules (no database, no Google, no React), shared by the screen, the save route and the tests.
 *
 * What a measurement is: a list of SHAPES drawn on the satellite photo. Each shape has a type —
 *   lawn    grass to mow                       (sq ft)
 *   bed     flower beds and landscaping        (sq ft; gets a mulch / pine straw estimate)
 *   cutout  a house, driveway, pool ...        (sq ft; taken OUT of the lawn total or the bed total)
 *   line    edging, fence, borders             (feet)
 * and an optional name. The screen measures each shape with Google's `geometry.spherical.computeArea` / `computeLength`
 * (lib/google-maps-client.ts) and sends the values; everything below works from those values.
 *
 * CUT-OUTS — what we chose: a cut-out is subtracted from the TOTAL of the type it "takes from" (Lawn by default, or Beds),
 * never clipped against one particular lawn shape. A true polygon overlap needs polygon clipping (a house outline that
 * is partly off the lawn, an L-shaped house...) and a wrong clip would silently misprice a job; the total rule is simple
 * and the crew lead can see why the number is what it is. The result never goes below zero. A cut-out drawn outside any
 * lawn still subtracts, so draw cut-outs only where they sit on grass or beds.
 *
 * Every material number is an ESTIMATE ("est."): it is area x the company's depth or coverage, with no waste or overlap.
 *
 * PRICING HOOK (not built, on purpose): a price-book "size option" (e.g. mowing Small / Medium / Large lot, branch
 * feat/price-sheet) would read the plain columns `lawn_sqft` / `bed_sqft` / `line_feet` of the newest `area_measurements`
 * row for the property (`GET /api/area-measure?property_id=` returns them as `latest`). Nothing here depends on that branch.
 */

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
  cutout: 'House, driveway, pool: taken out of the lawn or beds',
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

// ---- totals ----
export type AreaTotals = {
  /** Sum of every lawn shape, before cut-outs. */
  lawnGrossSqft: number
  /** Lawn after the cut-outs that take from lawn (never below 0). */
  lawnSqft: number
  bedGrossSqft: number
  bedSqft: number
  /** Cut-outs that take from lawn / from beds / both. */
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

/** The ONE totals rule: the screen's live totals and the saved totals are both this function over the same shapes. */
export function computeTotals(shapes: readonly AreaShape[], settings: AreaMeasureSettings = AREA_MEASURE_DEFAULTS): AreaTotals {
  let lawnGross = 0
  let bedGross = 0
  let cutLawn = 0
  let cutBed = 0
  let lineFeet = 0
  const counts: Record<ShapeType, number> = { lawn: 0, bed: 0, cutout: 0, line: 0 }
  for (const s of shapes) {
    counts[s.type] += 1
    if (s.type === 'lawn') lawnGross += num(s.sqft)
    else if (s.type === 'bed') bedGross += num(s.sqft)
    else if (s.type === 'cutout') {
      if (s.takesFrom === 'bed') cutBed += num(s.sqft)
      else cutLawn += num(s.sqft)
    } else lineFeet += num(s.feet)
  }
  const lawn = Math.max(0, lawnGross - cutLawn)
  const bed = Math.max(0, bedGross - cutBed)
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
 * only when it is a safe short token. The measured sqft / feet come from the browser (Google's computeArea) — they are
 * bounded here, and the TOTALS are always recomputed from them with `computeTotals`, never taken from the request.
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
      const sqft = raw.sqft
      if (typeof sqft !== 'number' || !Number.isFinite(sqft) || sqft < 0 || sqft > AREA_LIMITS.maxSqft) return { error: `Shape ${i + 1}: the area is not a valid number` }
      shape.sqft = round(sqft, 1)
      if (t === 'cutout') {
        if (raw.takesFrom !== undefined && raw.takesFrom !== 'lawn' && raw.takesFrom !== 'bed') return { error: `Shape ${i + 1}: a cut-out comes out of the lawn or the beds` }
        shape.takesFrom = raw.takesFrom === 'bed' ? 'bed' : 'lawn'
      }
    } else {
      const feet = raw.feet
      if (typeof feet !== 'number' || !Number.isFinite(feet) || feet < 0 || feet > AREA_LIMITS.maxFeet) return { error: `Shape ${i + 1}: the length is not a valid number` }
      shape.feet = round(feet, 1)
    }
    out.push(shape)
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
