/**
 * Pricing a quote with optional items — THE one function (client-safe, pure), used by the customer page (live), the
 * server check at approval and the staff save. It adds no maths of its own: it picks which lines count and hands them to
 * `computeProposalTotals` (lib/proposal-pricing-visibility.ts → lib/sales-tax.ts), so a quote with no optional items
 * prices exactly as it always did.
 */
import { computeProposalTotals, type ProposalTaxLineItem } from '@/lib/proposal-pricing-visibility'
import type { TaxRateInput } from '@/lib/sales-tax'

export type QuoteLine = ProposalTaxLineItem & {
  id: string
  is_optional?: boolean | null
  optional_default_on?: boolean | null
  /** What the customer reads — part of the fingerprint so a rename or a quantity change after the page opened is not approved blind. */
  name?: string | null
  description?: string | null
  quantity?: number | null
}

export type QuoteTaxMode =
  | { kind: 'rates'; rates: readonly TaxRateInput[]; exempt: boolean }
  | { kind: 'legacy'; percent: number }

export function isOptionalLine(l: Pick<QuoteLine, 'is_optional'>): boolean {
  return l.is_optional === true
}

/**
 * Is this line part of the quote's STORED price? Every required line, and an optional one only when it starts ticked.
 * Staff views and documents that show a quote nobody has approved yet (the proposal PDF) use this whatever the company
 * switch says, so an unticked option never prints as sold. No optional lines (every roofing quote) = always true.
 */
export function isCountedLine(l: { is_optional?: boolean | null; optional_default_on?: boolean | null }): boolean {
  return l.is_optional !== true || l.optional_default_on === true
}

/** The optional lines that are ticked when nobody has chosen yet. */
export function defaultSelectedIds(lines: readonly QuoteLine[]): string[] {
  return lines.filter((l) => isOptionalLine(l) && l.optional_default_on === true).map((l) => l.id)
}

/** Lines that count: every required line + the ticked optional ones. Order is kept. */
export function includedLines<T extends QuoteLine>(lines: readonly T[], selectedOptionalIds: Iterable<string>): T[] {
  const picked = new Set(selectedOptionalIds)
  return lines.filter((l) => !isOptionalLine(l) || picked.has(l.id))
}

export type QuotePrice = {
  subtotalCents: number
  discountCents: number
  taxCents: number
  totalCents: number
  taxableCents: number
  taxLines: Array<{ id: string | null; name: string; percent: number; amount_cents: number }>
  legacy: boolean
  exempt: boolean
  /** Each included line's own amount in cents, keyed by line id. */
  lineCents: Record<string, number>
}

export function priceQuote(input: {
  lines: readonly QuoteLine[]
  selectedOptionalIds: Iterable<string>
  discountPercent?: number | null
  discountAmount?: number | null
  tax: QuoteTaxMode
}): QuotePrice {
  const inc = includedLines(input.lines, input.selectedOptionalIds)
  const t = computeProposalTotals({
    items: inc,
    discountPercent: input.discountPercent,
    discountAmount: input.discountAmount,
    rates: input.tax.kind === 'rates' ? input.tax.rates : null,
    legacyRatePercent: input.tax.kind === 'legacy' ? input.tax.percent : 0,
    exempt: input.tax.kind === 'rates' ? input.tax.exempt : false,
  })
  const lineCents: Record<string, number> = {}
  inc.forEach((l, i) => {
    lineCents[l.id] = t.lineCents[i]
  })
  return {
    subtotalCents: t.subtotalCents,
    discountCents: t.discountCents,
    taxCents: t.taxCents,
    totalCents: t.totalCents,
    taxableCents: t.taxableCents,
    taxLines: t.taxLines,
    legacy: t.legacy,
    exempt: t.exempt,
    lineCents,
  }
}

/**
 * A short fingerprint of everything the customer's number depends on. The page sends it back with the approval; the
 * server compares it with a fresh one, so a price changed by the office after the page was opened is never approved blind.
 * Pure string (FNV-1a), no crypto needed: it is a change detector, not a secret.
 */
export function quoteFingerprint(input: {
  lines: readonly QuoteLine[]
  discountPercent?: number | null
  discountAmount?: number | null
  tax: QuoteTaxMode
  deposit?: { mode: string; percent: number; fixedCents: number }
  terms?: string
  /** The scope text the customer reads. */
  scope?: string
}): string {
  const body = JSON.stringify({
    l: input.lines.map((l) => [l.id, Math.round((Number(l.line_total) || 0) * 100), Math.round((Number(l.unit_price) || 0) * 100), l.unit ?? '', l.price_type ?? '', l.taxable ?? null, l.is_optional === true, l.optional_default_on === true, l.name ?? '', l.description ?? '', l.quantity ?? null]),
    dp: Number(input.discountPercent) || 0,
    da: Math.round((Number(input.discountAmount) || 0) * 100),
    t: input.tax.kind === 'legacy' ? ['legacy', input.tax.percent] : ['rates', input.tax.exempt, input.tax.rates.map((r) => [r.id ?? '', r.percent])],
    d: input.deposit ? [input.deposit.mode, input.deposit.percent, input.deposit.fixedCents] : null,
    tm: input.terms ?? '',
    sc: input.scope ?? '',
  })
  let h = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
