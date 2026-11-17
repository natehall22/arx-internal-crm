/**
 * Server side of a quote: load the proposal + lines + tax rules ONCE (`loadQuoteContext`), price it, and turn it into the
 * customer's page (`buildQuoteView`, client-safe JSON). Both the page and the approval go through here, so what the
 * customer saw and what the server checks are the same numbers.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getDocumentBrand } from '@/lib/org-brand'
import { orgLogoHref } from '@/lib/files/files-object'
import { loadCustomerTaxExemption, loadOrgSalesTax } from '@/lib/sales-tax-server'
import { taxRatesByIds } from '@/lib/sales-tax'
import { orgDb } from '@/lib/supabase/org-db'
import { loadOrgFeatures } from '@/lib/org-features'
import { loadTemplates } from '@/lib/service-plans-db'
import { isRecurringLine, recurringFacts, recurringKey, templateOfferedOnQuote, type RecurringFacts, type RecurringTemplateFacts } from '@/lib/quotes/recurring'
import {
  isOptionalLine,
  priceQuote,
  quoteFingerprint,
  type QuoteLine,
  type QuotePrice,
  type QuoteTaxMode,
} from '@/lib/quotes/pricing'
import { depositCents, effectiveDeposit, readQuoteApprovalSettings, type QuoteApprovalSettings } from '@/lib/quotes/settings'

export type QuoteProposal = {
  id: string
  org_id: string
  opportunity_id: string | null
  status: string | null
  title: string | null
  proposal_number: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  customer_address: string | null
  discount_amount: number | null
  discount_percent: number | null
  tax_rate: number | null
  tax_lines: unknown
  tax_exempt: boolean | null
  total: number | null
  scope_of_work: string | null
  terms_conditions: string | null
  expires_at: string | null
  deposit_mode: string | null
  deposit_value: number | null
  created_by: string | null
}

export type QuoteLineRow = QuoteLine & {
  name: string
  description: string | null
  category: string | null
  quantity: number | null
  show_to_customer: boolean | null
  sort_order: number | null
  plan_start_date?: string | null
  plan_weekday?: number | null
}

/** A recurring line with the template it points at and what it works out to (only when the company has service plans on). */
export type RecurringLineInfo = { template: RecurringTemplateFacts; facts: RecurringFacts }

export type QuoteContext = {
  proposal: QuoteProposal
  lines: QuoteLineRow[]
  tax: QuoteTaxMode
  settings: QuoteApprovalSettings
  customerId: string | null
  /** Recurring lines by line id. A recurring line with no entry here (plans switched off, template gone) cannot be approved. */
  recurring: Record<string, RecurringLineInfo>
}

const PROPOSAL_COLS =
  'id, org_id, opportunity_id, status, title, proposal_number, customer_name, customer_email, customer_phone, customer_address, discount_amount, discount_percent, tax_rate, tax_lines, tax_exempt, total, scope_of_work, terms_conditions, expires_at, deposit_mode, deposit_value, created_by'
const LINE_COLS = 'id, name, description, category, unit, quantity, unit_price, line_total, taxable, show_to_customer, sort_order, is_optional, optional_default_on'
const RECURRING_LINE_COLS = `${LINE_COLS}, service_plan_template_id, plan_start_date, plan_weekday`

/** Is quote approval on for this company? (the `quoteApproval` switch) */
export async function quoteApprovalOn(admin: SupabaseClient, orgId: string): Promise<boolean> {
  return (await loadOrgFeatures(admin, orgId)).quoteApproval
}

export async function loadQuoteContext(admin: SupabaseClient, orgId: string, proposalId: string): Promise<QuoteContext | null> {
  const db = orgDb(admin, orgId)
  const { data: p } = await db.from('proposals').select(PROPOSAL_COLS).eq('id', proposalId).maybeSingle()
  if (!p) return null
  const proposal = p as QuoteProposal
  let { data: l, error: lineErr } = await db.from('proposal_line_items').select(RECURRING_LINE_COLS).eq('proposal_id', proposalId).order('sort_order', { ascending: true })
  // Before migration 202611300010 is applied the recurring columns do not exist: read the old column list (every quote without a recurring line is unchanged).
  if (lineErr) ({ data: l } = await db.from('proposal_line_items').select(LINE_COLS).eq('proposal_id', proposalId).order('sort_order', { ascending: true }))
  const lines = ((l ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    description: (r.description as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    unit: (r.unit as string | null) ?? null,
    quantity: r.quantity == null ? null : Number(r.quantity),
    unit_price: Number(r.unit_price) || 0,
    line_total: Number(r.line_total) || 0,
    taxable: typeof r.taxable === 'boolean' ? r.taxable : null,
    show_to_customer: typeof r.show_to_customer === 'boolean' ? r.show_to_customer : null,
    sort_order: r.sort_order == null ? null : Number(r.sort_order),
    is_optional: r.is_optional === true,
    optional_default_on: r.optional_default_on === true,
    service_plan_template_id: typeof r.service_plan_template_id === 'string' ? r.service_plan_template_id : null,
    plan_start_date: typeof r.plan_start_date === 'string' ? r.plan_start_date : null,
    plan_weekday: r.plan_weekday == null ? null : Number(r.plan_weekday),
  })) as QuoteLineRow[]

  // Recurring lines: the template's seasons / frequency / billing, priced with the plan's own maths. Plans off = no entry.
  const recurring: Record<string, RecurringLineInfo> = {}
  if (lines.some(isRecurringLine) && (await loadOrgFeatures(admin, orgId)).servicePlans) {
    const { templates } = await loadTemplates(admin, orgId)
    const byId = new Map(templates.map((t) => [t.id, t]))
    for (const ln of lines) {
      const t = ln.service_plan_template_id ? byId.get(ln.service_plan_template_id) : null
      if (!t) continue
      const template: RecurringTemplateFacts = { id: t.id, version: t.version, name: t.name, billing_basis: t.billing_basis, seasons: t.seasons, allowCustom: t.pricing.allowCustom, active: t.active }
      recurring[ln.id] = { template, facts: recurringFacts(template, ln as { unit_price: number; plan_start_date: string | null; plan_weekday: number | null }) }
      ln.recurring_key = recurringKey(template, ln as { unit_price: number; plan_start_date: string | null; plan_weekday: number | null })
    }
  }

  let customerId: string | null = null
  if (proposal.opportunity_id) {
    const { data: o } = await db.from('opportunities').select('customer_id').eq('id', proposal.opportunity_id).maybeSingle()
    customerId = (o as { customer_id?: string | null } | null)?.customer_id ?? null
  }
  const [salesTax, exemption, orgRow] = await Promise.all([
    loadOrgSalesTax(admin, orgId),
    loadCustomerTaxExemption(admin, orgId, customerId),
    admin.from('orgs').select('settings').eq('id', orgId).maybeSingle(),
  ])
  // Same rule as the proposal save (lib/sales-tax-server.ts proposalSalesTaxFields): a quote saved with a tax snapshot uses
  // the company's rates (by id); one without stays on its single typed rate.
  let tax: QuoteTaxMode
  if (Array.isArray(proposal.tax_lines) && salesTax) {
    const ids = (proposal.tax_lines as unknown[])
      .map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    tax = { kind: 'rates', rates: taxRatesByIds(salesTax, ids), exempt: exemption.exempt }
  } else {
    tax = { kind: 'legacy', percent: Number(proposal.tax_rate) || 0 }
  }
  return {
    proposal,
    lines,
    tax,
    settings: readQuoteApprovalSettings((orgRow.data as { settings?: unknown } | null)?.settings),
    customerId,
    recurring,
  }
}

export function quoteDeposit(ctx: QuoteContext, totalCents: number): { cents: number; mode: string; percent: number } {
  const d = effectiveDeposit(ctx.proposal, ctx.settings)
  return { cents: depositCents(totalCents, d), mode: d.mode, percent: d.percent }
}

export function quoteTerms(ctx: QuoteContext): string {
  return (ctx.proposal.terms_conditions ?? '').trim() || ctx.settings.terms
}

export function priceForSelection(ctx: QuoteContext, selected: Iterable<string>): QuotePrice {
  return priceQuote({
    lines: ctx.lines,
    selectedOptionalIds: selected,
    discountPercent: ctx.proposal.discount_percent,
    discountAmount: ctx.proposal.discount_amount,
    tax: ctx.tax,
  })
}

/** The recurring lines that are part of the sale for a selection (required + ticked optional), and any that cannot be sold (plans switched off, template gone or no longer offered). */
export function recurringForSelection(ctx: QuoteContext, selected: Iterable<string>): { chosen: Array<{ line: QuoteLineRow; info: RecurringLineInfo }>; unsupported: QuoteLineRow[] } {
  const picked = new Set(selected)
  const chosen: Array<{ line: QuoteLineRow; info: RecurringLineInfo }> = []
  const unsupported: QuoteLineRow[] = []
  for (const l of ctx.lines) {
    if (!isRecurringLine(l)) continue
    const info = ctx.recurring[l.id]
    if (!info || !templateOfferedOnQuote(info.template) || !(Number(l.unit_price) > 0) || !l.plan_start_date) {
      if (!isOptionalLine(l) || picked.has(l.id)) unsupported.push(l)
      continue
    }
    if (!isOptionalLine(l) || picked.has(l.id)) chosen.push({ line: l, info })
  }
  return { chosen, unsupported }
}

/**
 * THE sale amount of an approved quote, in cents: the one-time total (tax included, as signed) + the first-season value of each
 * recurring line chosen. It is what the signed contract carries as `project_cost`, so rpt_sales, the job's sale amount and the
 * commission base (contract minus the proposal's sales tax) all read it through their existing writers.
 */
export function saleCentsFor(oneTimeTotalCents: number, chosen: ReadonlyArray<{ info: RecurringLineInfo }>): number {
  return oneTimeTotalCents + chosen.reduce((n, c) => n + c.info.facts.firstSeasonCents, 0)
}

export function fingerprintOf(ctx: QuoteContext): string {
  const d = effectiveDeposit(ctx.proposal, ctx.settings)
  return quoteFingerprint({
    lines: ctx.lines,
    discountPercent: ctx.proposal.discount_percent,
    discountAmount: ctx.proposal.discount_amount,
    tax: ctx.tax,
    deposit: d,
    terms: quoteTerms(ctx),
    scope: ctx.proposal.scope_of_work ?? '',
  })
}

/* ------------------------------------------------------------------------------------------------------------------ *
 * The customer's page
 * ------------------------------------------------------------------------------------------------------------------ */

export type QuoteViewState = 'open' | 'approved' | 'expired' | 'unavailable'

export type QuoteView = {
  state: QuoteViewState
  company: { name: string; phone: string; email: string; logoHref: string | null }
  customerName: string
  address: string
  title: string
  number: string
  scope: string
  /** Required lines the customer sees by name. */
  required: Array<{ id: string; name: string; description: string; cents: number; quantity?: number | null; unit?: string }>
  /** Required lines the office chose not to itemize, as one amount (so the total still adds up). */
  hiddenRequiredCents: number
  options: Array<{ id: string; name: string; description: string; cents: number; defaultOn: boolean; quantity?: number | null; unit?: string }>
  /** Recurring service lines (a service plan is made on approval); shown apart from the one-time lines and total. */
  recurring: Array<{ id: string; name: string; description: string; detail: string; optional: boolean; defaultOn: boolean }>
  /** The short terms line(s) for the recurring part, one per billing basis in use. */
  recurringTerms: string[]
  /** False for a recurring-only quote: no one-time total, no deposit. */
  hasOneTime: boolean
  /** For the live total on the page: every line's own amount with its option flag. */
  lines: QuoteLine[]
  tax: QuoteTaxMode
  discountPercent: number
  discountAmount: number
  depositMode: string
  depositPercent: number
  depositFixedCents: number
  terms: string
  fingerprint: string
  /** Only when approved. */
  approval: null | {
    typedName: string
    approvedAt: string
    totalCents: number
    depositCents: number
    taxCents: number
    chosenNames: string[]
    depositState: 'none' | 'due' | 'paid' | 'pending'
    canPayOnline: boolean
    /** Site-relative download of the approved copy (token route), when the PDF exists. */
    copyHref: string | null
  }
}

/** Percent lines get their dollar amount from the pricing function, so each shown amount is what is charged. */
export function buildQuoteView(args: {
  ctx: QuoteContext
  state: QuoteViewState
  company: QuoteView['company']
  approval: QuoteView['approval']
}): QuoteView {
  const { ctx } = args
  const all = priceForSelection(ctx, ctx.lines.filter(isOptionalLine).map((l) => l.id))
  const required: QuoteView['required'] = []
  const options: QuoteView['options'] = []
  let hiddenRequiredCents = 0
  const recurring: QuoteView['recurring'] = []
  const terms: string[] = []
  for (const l of ctx.lines) {
    if (isRecurringLine(l)) {
      const info = ctx.recurring[l.id]
      if (info) {
        recurring.push({ id: l.id, name: l.name, description: l.description ?? '', detail: info.facts.detail, optional: isOptionalLine(l), defaultOn: l.optional_default_on === true })
        if (!terms.includes(info.facts.termsLine)) terms.push(info.facts.termsLine)
      }
      continue
    }
    const cents = all.lineCents[l.id] ?? 0
    if (isOptionalLine(l)) options.push({ id: l.id, name: l.name, description: l.description ?? '', cents, defaultOn: l.optional_default_on === true, quantity: l.quantity ?? null, unit: l.unit ?? '' })
    else if (l.show_to_customer === false) hiddenRequiredCents += cents
    else required.push({ id: l.id, name: l.name, description: l.description ?? '', cents, quantity: l.quantity ?? null, unit: l.unit ?? '' })
  }
  const p = ctx.proposal
  const d = effectiveDeposit(p, ctx.settings)
  // A recurring line that cannot be sold (plans switched off, template removed) makes the quote unavailable rather than approvable.
  const blocked = args.state === 'open' && recurringForSelection(ctx, ctx.lines.filter(isOptionalLine).map((l) => l.id)).unsupported.length > 0
  return {
    state: blocked ? 'unavailable' : args.state,
    company: args.company,
    customerName: p.customer_name ?? '',
    address: p.customer_address ?? '',
    title: p.title ?? 'Quote',
    number: p.proposal_number ?? '',
    scope: p.scope_of_work ?? '',
    required,
    hiddenRequiredCents,
    options,
    recurring,
    recurringTerms: terms,
    hasOneTime: ctx.lines.some((l) => !isRecurringLine(l)),
    lines: ctx.lines.map((l) => ({ id: l.id, unit: l.unit, unit_price: l.unit_price, line_total: l.line_total, taxable: l.taxable, is_optional: l.is_optional, optional_default_on: l.optional_default_on, ...(isRecurringLine(l) ? { service_plan_template_id: l.service_plan_template_id } : {}) })),
    tax: ctx.tax,
    discountPercent: Number(p.discount_percent) || 0,
    discountAmount: Number(p.discount_amount) || 0,
    depositMode: d.mode,
    depositPercent: d.percent,
    depositFixedCents: d.fixedCents,
    terms: quoteTerms(ctx),
    fingerprint: fingerprintOf(ctx),
    approval: args.approval,
  }
}

export async function companyForQuote(admin: SupabaseClient, orgId: string): Promise<QuoteView['company']> {
  const brand = await getDocumentBrand(admin, orgId)
  const { data: org } = await admin.from('orgs').select('logo_url, settings').eq('id', orgId).maybeSingle()
  const logoHref = orgLogoHref(orgId, (org ?? {}) as Parameters<typeof orgLogoHref>[1])
  return { name: brand.casualName || brand.name, phone: brand.phone, email: brand.email, logoHref }
}
