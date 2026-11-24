/**
 * Truck sheet — the pure rules (client-safe, no I/O). The truck sheet is the crew's "Today's sheet" PDF (lib/crew-day-sheet.ts
 * builds it, lib/pdf/crew-day-sheet.ts draws it) with three more things for the day: a LOAD LIST (what goes on the truck), the
 * MACHINES each stop needs, and the OFFICE'S NOTE for the crew. Never a price: nothing here carries one.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Load list: which sold lines are things you load, and how they add up
// ---------------------------------------------------------------------------------------------------------------------

/** A sold line as the load list reads it: only the words and the amount (the price never comes in). */
export type SoldLine = { name: string; category?: string | null; unit?: string | null; quantity: number }
export type LoadItem = { name: string; unit: string; quantity: number }

/**
 * Units that are a service, not a thing: a visit, a month of service, an hour of labor, "the job", a percent line. A line sold in one
 * of these is never loaded. (Square, each, lf, sheet, sqft, acre, yard … are things.)
 */
export const NON_PHYSICAL_UNITS: readonly string[] = ['visit', 'month', 'year', 'hour', 'job', 'percent']

/** Price-book categories (and line names) that are money or work, not material: labor, permits, discounts, credits, tax, fees, disposal, service. */
const NON_PHYSICAL_CATEGORY = /\b(labou?r|permits?|discounts?|credits?|tax(es)?|fees?|disposal|dump(ster)?|haul(ing)?|clean[- ]?up|service)\b/i
const NON_PHYSICAL_NAME = /^\s*(labou?r|permits?|discounts?|credits?|(sales )?tax|fee|dump fee)\b/i

/** THE rule: is this sold line something that goes on the truck? Decided by the line's own price-book category and unit (snapshotted on the line). */
export function isLoadable(line: SoldLine): boolean {
  if (!(Number(line.quantity) > 0)) return false
  const unit = normalizeUnit(line.unit)
  if (unit && NON_PHYSICAL_UNITS.includes(unit)) return false
  if (line.category && NON_PHYSICAL_CATEGORY.test(line.category)) return false
  if (line.name && NON_PHYSICAL_NAME.test(line.name)) return false
  return !!line.name?.trim()
}

/** One spelling per unit: yd / yard / yards / cu yd / cubic yard(s) are all cubic yards ('yard'). Everything else is lower-cased as written (roofing 'square' stays 'square': it is the price book's own unit). */
export function normalizeUnit(unit: string | null | undefined): string {
  const u = (unit ?? '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  if (['yd', 'yds', 'yard', 'yards', 'cu yd', 'cu yds', 'cuyd', 'cubic yard', 'cubic yards', 'cy'].includes(u)) return 'yard'
  return u
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The loadable lines of a stop, the same item + unit added together (case and spacing ignored); first spelling and first-seen order kept. */
export function combineLoad(lines: readonly SoldLine[]): LoadItem[] {
  const out = new Map<string, LoadItem>()
  for (const l of lines) {
    if (!isLoadable(l)) continue
    const name = l.name.trim().replace(/\s+/g, ' ')
    const unit = normalizeUnit(l.unit)
    const key = `${name.toLowerCase()}|${unit}`
    const cur = out.get(key)
    if (cur) cur.quantity = round2(cur.quantity + Number(l.quantity))
    else out.set(key, { name, unit, quantity: round2(Number(l.quantity)) })
  }
  return Array.from(out.values())
}

/** The day's load: every stop's items combined by item + unit. */
export function dayLoad(perStop: ReadonlyArray<readonly LoadItem[]>): LoadItem[] {
  return combineLoad(perStop.flat().map((i) => ({ name: i.name, unit: i.unit, quantity: i.quantity })))
}

const UNIT_WORDS: Record<string, [string, string]> = { each: ['', ''], lf: ['lf', 'lf'], sqft: ['sq ft', 'sq ft'], per_sqft: ['sq ft', 'sq ft'], square: ['square', 'squares'], sheet: ['sheet', 'sheets'], acre: ['acre', 'acres'], yard: ['cu yd', 'cu yd'] }

/** "12" / "2.5 squares" / "40 lf": the amount with its unit, in plain words. */
export function quantityText(i: Pick<LoadItem, 'quantity' | 'unit'>): string {
  const q = String(i.quantity)
  const w = UNIT_WORDS[i.unit]
  const word = w ? (i.quantity === 1 ? w[0] : w[1]) : i.unit
  return word ? `${q} ${word}` : q
}

// ---------------------------------------------------------------------------------------------------------------------
// Beds (from the yard measure)
// ---------------------------------------------------------------------------------------------------------------------

export type BedAmounts = { bedSqft: number; mulchCuYd: number; strawBales: number }

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/**
 * The bed materials of one saved measurement, AS STORED: the totals the measure saved (`totals.materials`). An older row with no
 * saved totals is worked out from its bed area with the settings saved on that row, else the company's — the same two formulas the
 * measure tool uses (lib/area-measure.ts), passed in so this stays pure. Null when the property has no beds.
 */
export function bedAmountsOf(
  row: { bed_sqft: number; totals?: unknown; settings?: unknown },
  fallback: { mulchDepthIn: number; strawSqftPerBale: number },
  calc: { mulchCubicYards: (sqft: number, depthIn: number) => number; pineStrawBales: (sqft: number, sqftPerBale: number) => number }
): BedAmounts | null {
  const bed = pos(row.bed_sqft) ?? 0
  if (!(bed > 0)) return null
  const stored = ((row.totals ?? {}) as { materials?: { mulchCuYd?: unknown; strawBales?: unknown } }).materials
  const mulch = pos(stored?.mulchCuYd)
  const straw = pos(stored?.strawBales)
  if (mulch != null && straw != null) return { bedSqft: bed, mulchCuYd: mulch, strawBales: straw }
  const s = (row.settings ?? {}) as { mulchDepthIn?: unknown; strawSqftPerBale?: unknown }
  const depth = pos(s.mulchDepthIn) || fallback.mulchDepthIn
  const perBale = pos(s.strawSqftPerBale) || fallback.strawSqftPerBale
  return { bedSqft: bed, mulchCuYd: calc.mulchCubicYards(bed, depth), strawBales: calc.pineStrawBales(bed, perBale) }
}

/**
 * Is this stop bed work? (Only then do its measured beds count toward what to LOAD today.) True when any of the stop's words — plan
 * or visit name, the services sold ("Mow, Edge, Beds"), quote / sold line names and categories — mention mulch, straw or beds.
 */
export function isBedWork(texts: ReadonlyArray<string | null | undefined>): boolean {
  return texts.some((t) => !!t && /\b(mulch|mulching|pine ?straw|straw|beds?)\b/i.test(t))
}

/**
 * The bed total to load: each PROPERTY once (two visits at one home on the same day are the same beds), mulch added to two decimals,
 * bales are already whole numbers per property.
 */
export function dayBeds(stops: ReadonlyArray<{ propertyKey: string | null; beds: BedAmounts | null }>): { mulchCuYd: number; strawBales: number; properties: number } {
  const seen = new Set<string>()
  let mulch = 0
  let straw = 0
  for (const s of stops) {
    if (!s.beds) continue
    if (s.propertyKey) {
      if (seen.has(s.propertyKey)) continue
      seen.add(s.propertyKey)
    }
    mulch += s.beds.mulchCuYd
    straw += s.beds.strawBales
  }
  return { mulchCuYd: round2(mulch), strawBales: straw, properties: seen.size }
}

// ---------------------------------------------------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------------------------------------------------

/** The machines a visit uses: its own list when it has one (even an empty one = none), else its plan's default, else none. */
export function resolveEquipment(visitOverride: readonly string[] | null | undefined, planDefault: readonly string[] | null | undefined): string[] {
  if (Array.isArray(visitOverride)) return [...visitOverride]
  return Array.isArray(planDefault) ? [...planDefault] : []
}

/** The day's machines: each distinct one once, first-seen order. */
export function distinctEquipment(perStop: ReadonlyArray<readonly string[]>): string[] {
  return Array.from(new Set(perStop.flat()))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_EQUIPMENT_PER_STOP = 20

/** A list of machines from a request: `null` / missing = "use the plan's"; an array = exactly those (distinct, uuids, ≤ 20). */
export function cleanEquipmentIds(input: unknown): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null }
  if (!Array.isArray(input)) return { ok: false, error: 'Machines must be a list' }
  const ids: string[] = []
  for (const x of input) {
    if (typeof x !== 'string' || !UUID.test(x)) return { ok: false, error: 'Pick machines from the list' }
    const id = x.toLowerCase()
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length > MAX_EQUIPMENT_PER_STOP) return { ok: false, error: `Up to ${MAX_EQUIPMENT_PER_STOP} machines` }
  return { ok: true, value: ids }
}

export function sameIds(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null
  return a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])
}

// ---------------------------------------------------------------------------------------------------------------------
// The office's note for a crew's day
// ---------------------------------------------------------------------------------------------------------------------

export const CREW_NOTE_MAX = 1000

/** A note from a request: trimmed text (blank = clear the note), or why not. */
export function cleanCrewNote(input: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null }
  if (typeof input !== 'string') return { ok: false, error: 'The note must be text' }
  const t = input.replace(/\r\n/g, '\n').trim()
  if (!t) return { ok: true, value: null }
  if (t.length > CREW_NOTE_MAX) return { ok: false, error: `Keep the note under ${CREW_NOTE_MAX} characters` }
  return { ok: true, value: t }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stop order
// ---------------------------------------------------------------------------------------------------------------------

/** Route order for a mixed day: the stop number (visit: its own, else its plan's; unnumbered last), visits before job stops on a tie, then address, then id. */
export function sortStops<T extends { position: number | null; kind: 'visit' | 'job'; address: string | null; id: string }>(stops: readonly T[]): T[] {
  return [...stops].sort(
    (a, b) =>
      (a.position ?? 10_000) - (b.position ?? 10_000) ||
      (a.kind === b.kind ? 0 : a.kind === 'visit' ? -1 : 1) ||
      (a.address ?? '').localeCompare(b.address ?? '') ||
      a.id.localeCompare(b.id)
  )
}

/**
 * THE stop number, for every surface that shows the same list (the printed sheet and the crew phone page): the stop's own number
 * (a saved order, else its plan's), else its place in the list. Call it on the day's FULL list of non-cancelled stops in route order
 * (done ones included), then show only what you need — so a stop keeps one number on paper and on the phone.
 */
export function stopNumbers(stops: ReadonlyArray<{ id: string; position: number | null }>): Map<string, number> {
  return new Map(stops.map((s, i) => [s.id, s.position ?? i + 1]))
}

/**
 * THE machine rule: a price-book item is a machine when it is on, billed by the hour and not labor. The time clock's list
 * (`loadEquipmentChoices`) and the plan / visit machine pickers both use it.
 */
export function isMachineItem(r: { unit?: unknown; active?: unknown; is_labor?: unknown }): boolean {
  return r.unit === 'hour' && r.active !== false && r.is_labor !== true
}
