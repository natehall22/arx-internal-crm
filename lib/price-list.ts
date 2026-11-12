/**
 * Price lists, size options and "what does this line cost" — THE one place (pure, client-safe).
 *
 * - A company keeps one or more price lists (`pricebooks`). A customer may point at one (`customers.pricebook_id`, e.g.
 *   "Builder"), and so may a quote (`proposals.pricebook_id`). No pointer = the default list. `resolvePriceList` is the
 *   only rule for which list a quote uses.
 * - An item may carry named size options (`pricebook_items.price_options`, e.g. Small lot $45 / Medium lot $60). The rep
 *   taps one; the line stores the option's name and price. No formulas: a price is a number somebody typed.
 * - `resolveLinePrice` is the only function that turns (item, chosen option, typed price) into a line's unit price. The
 *   quote builder, the server save and the hourly-billing rates all call it, so an item without options prices exactly
 *   as it always did (`unit_price`).
 *
 * The option shape (key, label, price) is the core of a service-plan `PricingTier` (lib/service-plans.ts) on purpose, but
 * it is NOT that type: tiers carry conditions and billing bases, and a quote must not depend on service plans.
 */

export const MAX_PRICE_OPTIONS = 12
const MAX_LABEL = 60
const MAX_PRICE = 1_000_000

export type PriceOption = { key: string; label: string; price: number }

const roundMoney = (n: number) => Math.round(n * 100) / 100

function moneyValue(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[$,\s]/g, '')) : NaN
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? roundMoney(n) : null
}

/** Lenient read of stored options: a bad row never crashes a screen. Order is kept. */
export function readPriceOptions(raw: unknown): PriceOption[] {
  if (!Array.isArray(raw)) return []
  const out: PriceOption[] = []
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, unknown>
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_LABEL) : ''
    const price = moneyValue(r.price)
    const key = typeof r.key === 'string' && r.key.trim() ? r.key.trim() : ''
    if (!label || price === null || !key || out.some((x) => x.key === key)) continue
    out.push({ key, label, price })
  }
  return out
}

/** A stable key for a new option (never changes when the label is edited, so an open quote keeps pointing at it). */
function newOptionKey(taken: ReadonlySet<string>): string {
  let i = taken.size + 1
  while (taken.has(`o${i}`)) i++
  return `o${i}`
}

/**
 * A save from the editor → clean options, or why not. Empty / missing = no options (null). Labels must be unique
 * (case-insensitive) so the rep never sees two identical buttons.
 */
export function cleanPriceOptions(raw: unknown): { ok: true; value: PriceOption[] | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!Array.isArray(raw)) return { ok: false, error: 'Options must be a list' }
  if (raw.length === 0) return { ok: true, value: null }
  if (raw.length > MAX_PRICE_OPTIONS) return { ok: false, error: `At most ${MAX_PRICE_OPTIONS} options` }
  const taken = new Set<string>()
  for (const o of raw) {
    const k = o && typeof o === 'object' ? (o as Record<string, unknown>).key : null
    if (typeof k === 'string' && k.trim()) taken.add(k.trim())
  }
  const seenKeys = new Set<string>()
  const seenLabels = new Set<string>()
  const out: PriceOption[] = []
  for (const o of raw) {
    const r = o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    if (!label) return { ok: false, error: 'Each option needs a name' }
    if (label.length > MAX_LABEL) return { ok: false, error: `“${label.slice(0, 20)}…” is too long (up to ${MAX_LABEL} characters)` }
    const price = moneyValue(r.price)
    if (price === null) return { ok: false, error: `Enter a price for “${label}”` }
    if (seenLabels.has(label.toLowerCase())) return { ok: false, error: `“${label}” is listed twice` }
    let key = typeof r.key === 'string' && r.key.trim() ? r.key.trim() : ''
    if (!key || seenKeys.has(key)) {
      key = newOptionKey(new Set([...Array.from(taken), ...Array.from(seenKeys)]))
    }
    seenKeys.add(key)
    seenLabels.add(label.toLowerCase())
    out.push({ key, label, price })
  }
  return { ok: true, value: out }
}

/** The lowest option price: what the item's own `unit_price` holds when it has options ("from $45"). */
export function optionsFloorPrice(options: readonly PriceOption[]): number {
  return options.length ? Math.min(...options.map((o) => o.price)) : 0
}

// ---------------------------------------------------------------------------------------------------------------------
// Which list
// ---------------------------------------------------------------------------------------------------------------------

export type PriceListRef = { id: string; name?: string; is_default?: boolean | null }

/**
 * Pure: the list a quote uses. The quote's own choice, else the customer's list, else the company default. A pointer to a
 * list that is not in `lists` (deleted, or another company's id) is ignored and the next rule applies, so a stale pointer
 * can never price a quote from the wrong place. No lists at all = `none` (the caller falls back to every item, as before).
 */
export function resolvePriceList(input: {
  quoteListId?: string | null
  customerListId?: string | null
  lists: readonly PriceListRef[]
}): { id: string | null; source: 'quote' | 'customer' | 'default' | 'none' } {
  const has = (id: string | null | undefined): id is string => !!id && input.lists.some((l) => l.id === id)
  if (has(input.quoteListId)) return { id: input.quoteListId, source: 'quote' }
  if (has(input.customerListId)) return { id: input.customerListId, source: 'customer' }
  const def = input.lists.find((l) => l.is_default) ?? input.lists[0]
  return def ? { id: def.id, source: 'default' } : { id: null, source: 'none' }
}

/**
 * Pure: which items a quote may offer. One list (every company today, roofing included) = every item, exactly as before.
 * Several lists = only the chosen list's items.
 */
export function itemsForList<T extends { pricebook_id?: string | null }>(items: readonly T[], listCount: number, listId: string | null): T[] {
  if (listCount <= 1 || !listId) return [...items]
  return items.filter((i) => i.pricebook_id === listId)
}

// ---------------------------------------------------------------------------------------------------------------------
// What a line costs
// ---------------------------------------------------------------------------------------------------------------------

export type PriceableItem = { unit_price: number | string | null; price_options?: unknown }

export type PricedLine = {
  unitPrice: number
  /** The tapped option (null when the item has none or the rep typed a price without choosing). */
  optionKey: string | null
  optionName: string | null
  /** That option's LIST price. `unitPrice` differs when the rep overrode it. */
  optionPrice: number | null
  source: 'item' | 'option' | 'manual'
}

/**
 * Pure: the unit price of a quote line.
 *   no options          → the item's unit_price
 *   options             → the tapped option's price (an item with options needs one; nothing is guessed)
 *   typed price (manual) → that price wins, as it does today; the tapped option is still remembered
 */
export function resolveLinePrice(input: {
  item: PriceableItem
  optionKey?: string | null
  manualPrice?: number | null
}): { ok: true; line: PricedLine } | { ok: false; error: 'choose_option' | 'unknown_option' } {
  const options = readPriceOptions(input.item.price_options)
  const itemPrice = roundMoney(Number(input.item.unit_price) || 0)
  const manual = input.manualPrice != null && Number.isFinite(Number(input.manualPrice)) && Number(input.manualPrice) >= 0 ? roundMoney(Number(input.manualPrice)) : null

  let option: PriceOption | null = null
  if (input.optionKey) {
    option = options.find((o) => o.key === input.optionKey) ?? null
    if (!option) return { ok: false, error: 'unknown_option' }
  } else if (options.length > 0 && manual === null) {
    return { ok: false, error: 'choose_option' }
  }

  const listPrice = option ? option.price : itemPrice
  const unitPrice = manual !== null ? manual : listPrice
  return {
    ok: true,
    line: {
      unitPrice,
      optionKey: option?.key ?? null,
      optionName: option?.label ?? null,
      optionPrice: option?.price ?? null,
      source: manual !== null && manual !== listPrice ? 'manual' : option ? 'option' : 'item',
    },
  }
}

/** "Standard yard mowing (Medium lot)" — the name a quote line shows, so every document that prints the name prints the size. */
export function lineNameWithOption(name: string, optionName: string | null | undefined): string {
  const o = (optionName ?? '').trim()
  return o ? `${name} (${o})` : name
}

type LineWithOption = Record<string, unknown> & { pricebook_item_id?: unknown; price_option_key?: unknown }

/**
 * Pure: make the stored option fields on a save come from the price book, not from the browser. A line that names an
 * item and one of its options gets that option's name and list price; anything else (no item, item gone, option gone)
 * gets none, and the line's name is rebuilt as `item name (option)` from the price book. The typed unit price is left
 * alone — overriding a price is allowed, as it always was.
 */
export function stampPriceOptions<T extends LineWithOption>(
  lines: readonly T[],
  itemsById: ReadonlyMap<string, { name?: string | null; price_options?: unknown }>
): Array<T & { price_option_key?: string; price_option_name?: string; price_option_price?: number }> {
  return lines.map((l) => {
    const { price_option_key: key, ...rest } = l
    const itemId = typeof l.pricebook_item_id === 'string' ? l.pricebook_item_id : null
    const item = itemId ? itemsById.get(itemId) : undefined
    const option = item && typeof key === 'string' ? readPriceOptions(item.price_options).find((o) => o.key === key) : undefined
    const { price_option_name: _n, price_option_price: _p, ...clean } = rest as Record<string, unknown>
    // The size on the line's name is the server's: item name + the stamped option, whatever name the browser sent. The typed
    // unit price is left alone (an override of the option's list price is allowed; price_option_price keeps the list price).
    const named = option && item?.name ? { name: lineNameWithOption(item.name, option.label) } : {}
    return (option ? { ...clean, ...named, price_option_key: option.key, price_option_name: option.label, price_option_price: option.price } : clean) as T & {
      price_option_key?: string
      price_option_name?: string
      price_option_price?: number
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Units: THE one list and the one set of words (the builder, the add-on editor, the importer and the profiles read these)
// ---------------------------------------------------------------------------------------------------------------------

/** Service units from migration 202611100090. */
export const PROFILE_ONLY_UNITS: readonly string[] = ['visit', 'month', 'hour']
/** Price-sheet units from migration 202611220030 (NOT applied until the office's migration run). */
export const PRICE_SHEET_UNITS: readonly string[] = ['package', 'pallet', 'lot', 'home', 'load', 'service']
/** Every unit a fixed-price item may be saved in, besides the roofing-only ones the roofing profile lists itself. */
export const IMPORTABLE_UNITS: readonly string[] = ['each', 'job', 'lf', 'per_sqft', ...PROFILE_ONLY_UNITS, ...PRICE_SHEET_UNITS]
/** Which migration adds a service unit (for the "needs a database update" message). */
export const SERVICE_UNIT_MIGRATION: Readonly<Record<string, string>> = {
  ...Object.fromEntries(PROFILE_ONLY_UNITS.map((u) => [u, '202611100090'])),
  ...Object.fromEntries(PRICE_SHEET_UNITS.map((u) => [u, '202611220030'])),
}

const unitKey = (u?: string | null) => (u || '').trim().toLowerCase()

/** Service units: singular after "per" ("per pallet"), plural after a quantity ("3 pallets"). Derived from the two lists above. */
const SERVICE_UNIT_PLURAL: Record<string, string> = Object.fromEntries([...PROFILE_ONLY_UNITS, ...PRICE_SHEET_UNITS].map((u) => [u, `${u}s`]))

/** Units where the rep types how many (the builder opens its quantity box). Roofing's own list is kept exactly. */
const QUANTITY_UNITS = new Set<string>([
  'each', 'sheet', 'sheets', 'bundle', 'bundles', 'roll', 'rolls', 'piece', 'pieces', 'unit', 'units', 'lf', 'linear foot', 'linear feet', 'per_sqft',
  'hours',
  ...PROFILE_ONLY_UNITS, 'visits', 'months',
  ...PRICE_SHEET_UNITS,
])
export function unitNeedsQuantity(unit?: string | null): boolean {
  return QUANTITY_UNITS.has(unitKey(unit))
}

/**
 * The word for a quantity of this unit ("3 pallets", "How many loads do you need?"). The old units keep the builder's
 * original words exactly (parity-tested); only the service units are new.
 */
export function unitLabel(unit: string): string {
  const u = unitKey(unit)
  if (SERVICE_UNIT_PLURAL[u]) return SERVICE_UNIT_PLURAL[u]
  switch (u) {
    case 'per_sqft':
    case 'sqft':
    case 'sq ft':
    case 'sf':
      return 'sq ft'
    case 'square':
    case 'sq':
    case 'squares':
      return 'squares'
    case 'lf':
      return 'linear ft'
    case 'each':
      return 'each'
    case 'job':
      return 'job'
    case 'watt':
      return 'watts'
    case 'bundle':
      return 'bundles'
    case 'roll':
      return 'rolls'
    case 'sheet':
      return 'sheets'
    case 'percent':
      return '% of total'
    default:
      return unit || 'units'
  }
}

/** The word after "per": singular for the service units ("per pallet"), else the usual label. */
export function perUnitLabel(unit: string): string {
  const u = unitKey(unit)
  return SERVICE_UNIT_PLURAL[u] ? u : unitLabel(unit)
}

/** The unit as the add-on editor's tables and labels show it (stored value may be `per_sqft`, etc.). */
export function unitLabelForDisplay(unit: string): string {
  switch (unit) {
    case 'per_sqft':
      return 'sq ft'
    case 'sqft':
      return 'sq ft (roof auto)'
    default:
      return unit
  }
}
