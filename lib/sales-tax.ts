/**
 * Sales tax — THE one calculation and THE one settings reader (client-safe, pure).
 *
 * Every document that charges sales tax computes it here: proposals (builder screen, proposal page, customer PDF,
 * server save), invoices (`job_invoices`, lib/invoices.ts recalculation), the legacy estimates tool
 * (lib/calculations.ts) and service plans. Never write a second `amount * rate` anywhere else.
 *
 * Settings: `orgs.settings.salesTax` = { enabled, rates: [{ id, name, percent, active }], defaultRateIds }.
 *   - Rates stack: a document's tax is one line per rate (e.g. "NC state 4.75%" + "Cabarrus County 2.25%").
 *   - `defaultRateIds` is the stack a new document starts with; the person writing it may add/remove rates.
 *   - `enabled: false` = the company charges no sales tax at all (no tax rows on new documents).
 *   - Written ONLY by PATCH /api/admin/settings `type: 'salesTax'` (owners) via mergeOrgSettings path ['salesTax'].
 *   - NOT SET UP (no `salesTax` key) = the original behaviour: proposals carry ONE hand-typed rate per quote
 *     (`proposals.tax_rate`, starting at LEGACY_MANUAL_DEFAULT_PERCENT), every line taxed; invoices add no tax.
 *     New companies are seeded with NEW_COMPANY_SALES_TAX (set up, no rates) so they never inherit that.
 *
 * Taxable lines: `line override ?? price-book item is_taxable ?? true` (lineIsTaxable). A tax-exempt customer
 * (`customers.tax_exempt`) gets no tax lines at all.
 *
 * ROUNDING RULE (matches the original proposal math): tax is computed ONCE PER DOCUMENT PER RATE —
 * `Math.round(taxableCents * (percent / 100))`, half-up to the cent — never per line. With one rate and every line
 * taxable this is exactly the old proposal formula (`round(afterDiscountCents * rate / 100)`), so stored
 * proposals reproduce to the cent (golden test lib/__tests__/sales-tax.test.ts). Stacked rates are rounded per rate,
 * so 4.75% + 2.25% can differ by 1¢ from a single 7% line; that is the per-jurisdiction figure a return reports.
 *
 * Discounts: a document-level discount reduces the taxable amount in proportion to the taxable share of the
 * subtotal (all-taxable → the whole discount; nothing taxable → none), rounded once.
 */

export const SALES_TAX_SETTINGS_KEY = 'salesTax'

/** Starting rate of a NOT-SET-UP company's proposal builder (the original hard-coded value; byte-identical). */
export const LEGACY_MANUAL_DEFAULT_PERCENT = 8.25

export const MAX_SALES_TAX_RATES = 20
export const MAX_SALES_TAX_PERCENT = 30

export type SalesTaxRate = { id: string; name: string; percent: number; active: boolean }

export type SalesTaxSettings = {
  /** false = this company charges no sales tax. */
  enabled: boolean
  rates: SalesTaxRate[]
  /** Rates a new document starts with (active rates only). */
  defaultRateIds: string[]
}

/** What a brand-new company gets: set up, tax on, no rate preset (the owner adds their own). */
export const NEW_COMPANY_SALES_TAX: Readonly<SalesTaxSettings> = Object.freeze({ enabled: true, rates: [], defaultRateIds: [] })

/** A rate as applied to one document. */
export type TaxRateInput = { id?: string | null; name: string; percent: number }

export type TaxDocLine = { amountCents: number; taxable: boolean }

/** One tax row on a document (also the stored snapshot shape, `tax_lines` jsonb on proposals and job_invoices). */
export type TaxLine = { id: string | null; name: string; percent: number; amount_cents: number }

export type SalesTaxResult = {
  subtotalCents: number
  discountCents: number
  /** Taxable amount after its share of the discount (0 when exempt). */
  taxableCents: number
  taxLines: TaxLine[]
  taxCents: number
  totalCents: number
  exempt: boolean
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

const RATE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/

/** Percent with at most 4 decimals, 0–30. Returns null if not a usable percent. */
export function normalizeTaxPercent(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < 0 || n > MAX_SALES_TAX_PERCENT) return null
  return Math.round(n * 10000) / 10000
}

/**
 * Validate a full settings object (the owner's save). Returns the cleaned value or a plain-words error.
 * Ids are kept stable so stored document snapshots still name the rate they used.
 */
export function parseSalesTaxSettings(input: unknown): { value: SalesTaxSettings } | { error: string } {
  const o = asObject(input)
  if (!o) return { error: 'Sales tax settings are missing' }
  if (typeof o.enabled !== 'boolean') return { error: 'Say whether sales tax is on or off' }
  if (!Array.isArray(o.rates)) return { error: 'Tax rates must be a list' }
  if (o.rates.length > MAX_SALES_TAX_RATES) return { error: `At most ${MAX_SALES_TAX_RATES} tax rates` }
  const rates: SalesTaxRate[] = []
  const seen = new Set<string>()
  for (const raw of o.rates) {
    const r = asObject(raw)
    if (!r) return { error: 'Each tax rate needs a name and a percent' }
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    if (!RATE_ID.test(id)) return { error: 'A tax rate has a bad id' }
    if (seen.has(id)) return { error: 'Two tax rates share an id' }
    seen.add(id)
    const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return { error: 'Each tax rate needs a name' }
    if (name.length > 60) return { error: `Tax rate name "${name.slice(0, 20)}…" is longer than 60 characters` }
    const percent = normalizeTaxPercent(r.percent)
    if (percent === null) return { error: `"${name}" needs a percent between 0 and ${MAX_SALES_TAX_PERCENT}` }
    rates.push({ id, name, percent, active: r.active !== false })
  }
  const activeIds = new Set(rates.filter((r) => r.active).map((r) => r.id))
  const ids = Array.isArray(o.defaultRateIds) ? o.defaultRateIds : []
  const defaultRateIds: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !activeIds.has(id)) return { error: 'A default rate must be one of the active rates' }
    if (!defaultRateIds.includes(id)) defaultRateIds.push(id)
  }
  return { value: { enabled: o.enabled, rates, defaultRateIds } }
}

/**
 * THE settings reader. `null` = this company has not set up sales tax (original behaviour, see header).
 * A malformed stored value reads as "set up, tax off" — never as the 8.25% legacy default.
 */
export function readSalesTaxSettings(orgSettings: unknown): SalesTaxSettings | null {
  const settings = asObject(orgSettings)
  if (!settings || !(SALES_TAX_SETTINGS_KEY in settings)) return null
  const parsed = parseSalesTaxSettings(settings[SALES_TAX_SETTINGS_KEY])
  if ('error' in parsed) return { enabled: false, rates: [], defaultRateIds: [] }
  return parsed.value
}

/** Rates a new document starts with: the default stack, or none when tax is off. */
export function defaultTaxRates(settings: SalesTaxSettings | null): SalesTaxRate[] {
  if (!settings?.enabled) return []
  return settings.defaultRateIds
    .map((id) => settings.rates.find((r) => r.id === id && r.active))
    .filter((r): r is SalesTaxRate => !!r)
}

/** Resolve chosen rate ids against the company's list (inactive rates still resolve, so an old draft keeps its rate). */
export function taxRatesByIds(settings: SalesTaxSettings | null, ids: readonly string[]): SalesTaxRate[] {
  if (!settings?.enabled) return []
  const out: SalesTaxRate[] = []
  for (const id of ids) {
    const r = settings.rates.find((x) => x.id === id)
    if (r && !out.includes(r)) out.push(r)
  }
  return out
}

/** Is this line taxed? Line override, else the price-book item's flag, else yes. */
export function lineIsTaxable(override?: boolean | null, itemDefault?: boolean | null): boolean {
  if (typeof override === 'boolean') return override
  if (typeof itemDefault === 'boolean') return itemDefault
  return true
}

/** THE calculation. Integer cents in, integer cents out. */
export function computeSalesTax(input: {
  lines: readonly TaxDocLine[]
  discountCents?: number
  rates: readonly TaxRateInput[]
  exempt?: boolean
}): SalesTaxResult {
  const lines = input.lines.map((l) => ({ amountCents: Math.round(Number(l.amountCents) || 0), taxable: l.taxable }))
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0)
  // Same clamp as the original proposal math: 0 ≤ discount ≤ subtotal.
  const discountCents = Math.min(Math.max(Math.round(Number(input.discountCents) || 0), 0), subtotalCents)
  const afterDiscountCents = subtotalCents - discountCents
  const taxableBeforeCents = lines.filter((l) => l.taxable).reduce((s, l) => s + l.amountCents, 0)
  const allTaxable = lines.every((l) => l.taxable)
  let taxableCents: number
  if (allTaxable) taxableCents = afterDiscountCents
  else if (subtotalCents <= 0 || taxableBeforeCents <= 0) taxableCents = 0
  else taxableCents = Math.max(0, taxableBeforeCents - Math.round((discountCents * taxableBeforeCents) / subtotalCents))
  const exempt = input.exempt === true
  if (exempt) taxableCents = 0
  const taxLines: TaxLine[] = exempt
    ? []
    : input.rates.map((r) => {
        const percent = Number(r.percent) || 0
        return { id: r.id ?? null, name: r.name, percent, amount_cents: Math.round(taxableCents * (percent / 100)) }
      })
  const taxCents = taxLines.reduce((s, l) => s + l.amount_cents, 0)
  return { subtotalCents, discountCents, taxableCents, taxLines, taxCents, totalCents: afterDiscountCents + taxCents, exempt }
}

/**
 * The one entry point for code that bills a customer from company settings (invoices, service plans):
 * the company's default rate stack (or `rateIds` if the document chose its own), nothing when tax is off / not set
 * up / the customer is exempt.
 */
export function computeDocumentSalesTax(input: {
  settings: SalesTaxSettings | null
  lines: readonly TaxDocLine[]
  discountCents?: number
  customerExempt?: boolean
  rateIds?: readonly string[] | null
}): SalesTaxResult {
  const rates = input.rateIds ? taxRatesByIds(input.settings, input.rateIds) : defaultTaxRates(input.settings)
  return computeSalesTax({ lines: input.lines, discountCents: input.discountCents, rates, exempt: input.customerExempt })
}

/** Sum of stacked percents (what the old single `tax_rate` column holds for a snapshot document). */
export function combinedTaxPercent(rates: readonly { percent: number }[]): number {
  return Math.round(rates.reduce((s, r) => s + (Number(r.percent) || 0), 0) * 10000) / 10000
}

/** Read a stored `tax_lines` snapshot. `null` = no snapshot (a legacy single-rate document). */
export function readStoredTaxLines(v: unknown): TaxLine[] | null {
  if (!Array.isArray(v)) return null
  const out: TaxLine[] = []
  for (const raw of v) {
    const r = asObject(raw)
    if (!r) continue
    const cents = Math.round(Number(r.amount_cents))
    if (!Number.isFinite(cents)) continue
    out.push({
      id: typeof r.id === 'string' ? r.id : null,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Sales tax',
      percent: Number(r.percent) || 0,
      amount_cents: cents,
    })
  }
  return out
}

/** Customer-facing row label, e.g. "Cabarrus County (2.25%)". */
export function taxLineLabel(line: Pick<TaxLine, 'name' | 'percent'>): string {
  return `${line.name} (${line.percent}%)`
}

/**
 * Tax rows to print on an invoice (screen + print page): one per stored rate. Invoices with no snapshot (created
 * before sales tax, or never taxed) print none — their total is the subtotal, as before.
 */
export function invoiceTaxRows(invoice: { tax_lines?: unknown }): Array<{ label: string; amountCents: number }> {
  return (readStoredTaxLines(invoice.tax_lines) ?? []).map((l) => ({ label: taxLineLabel(l), amountCents: l.amount_cents }))
}

export type TaxExemptionPatch = {
  tax_exempt: boolean
  tax_exempt_reason: string | null
  tax_exempt_certificate_number: string | null
  tax_exempt_document_id: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate a customer exemption save. Turning exemption off clears reason, certificate number and file link. */
export function parseTaxExemptionPatch(input: unknown): { value: TaxExemptionPatch } | { error: string } {
  const o = asObject(input)
  if (!o || typeof o.tax_exempt !== 'boolean') return { error: 'Say whether the customer is tax exempt' }
  if (!o.tax_exempt) {
    return { value: { tax_exempt: false, tax_exempt_reason: null, tax_exempt_certificate_number: null, tax_exempt_document_id: null } }
  }
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const doc = o.tax_exempt_document_id
  if (doc != null && doc !== '' && (typeof doc !== 'string' || !UUID.test(doc))) return { error: 'Bad certificate file' }
  return {
    value: {
      tax_exempt: true,
      tax_exempt_reason: text(o.tax_exempt_reason, 200),
      tax_exempt_certificate_number: text(o.tax_exempt_certificate_number, 80),
      tax_exempt_document_id: typeof doc === 'string' && doc ? doc : null,
    },
  }
}
