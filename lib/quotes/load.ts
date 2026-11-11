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
}

export type QuoteContext = {
  proposal: QuoteProposal
  lines: QuoteLineRow[]
  tax: QuoteTaxMode
  settings: QuoteApprovalSettings
  customerId: string | null
}

const PROPOSAL_COLS =
  'id, org_id, opportunity_id, status, title, proposal_number, customer_name, customer_email, customer_phone, customer_address, discount_amount, discount_percent, tax_rate, tax_lines, tax_exempt, total, scope_of_work, terms_conditions, expires_at, deposit_mode, deposit_value, created_by'
const LINE_COLS = 'id, name, description, category, unit, quantity, unit_price, line_total, taxable, show_to_customer, sort_order, is_optional, optional_default_on'

/** Is quote approval on for this company? (the `quoteApproval` switch) */
export async function quoteApprovalOn(admin: SupabaseClient, orgId: string): Promise<boolean> {
  return (await loadOrgFeatures(admin, orgId)).quoteApproval
}

export async function loadQuoteContext(admin: SupabaseClient, orgId: string, proposalId: string): Promise<QuoteContext | null> {
  const db = orgDb(admin, orgId)
  const { data: p } = await db.from('proposals').select(PROPOSAL_COLS).eq('id', proposalId).maybeSingle()
  if (!p) return null
  const proposal = p as QuoteProposal
  const { data: l } = await db.from('proposal_line_items').select(LINE_COLS).eq('proposal_id', proposalId).order('sort_order', { ascending: true })
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
  })) as QuoteLineRow[]

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

export function fingerprintOf(ctx: QuoteContext): string {
  const d = effectiveDeposit(ctx.proposal, ctx.settings)
  return quoteFingerprint({
    lines: ctx.lines,
    discountPercent: ctx.proposal.discount_percent,
    discountAmount: ctx.proposal.discount_amount,
    tax: ctx.tax,
    deposit: d,
    terms: quoteTerms(ctx),
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
  required: Array<{ id: string; name: string; description: string; cents: number }>
  /** Required lines the office chose not to itemize, as one amount (so the total still adds up). */
  hiddenRequiredCents: number
  options: Array<{ id: string; name: string; description: string; cents: number; defaultOn: boolean }>
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
  for (const l of ctx.lines) {
    const cents = all.lineCents[l.id] ?? 0
    if (isOptionalLine(l)) options.push({ id: l.id, name: l.name, description: l.description ?? '', cents, defaultOn: l.optional_default_on === true })
    else if (l.show_to_customer === false) hiddenRequiredCents += cents
    else required.push({ id: l.id, name: l.name, description: l.description ?? '', cents })
  }
  const p = ctx.proposal
  const d = effectiveDeposit(p, ctx.settings)
  return {
    state: args.state,
    company: args.company,
    customerName: p.customer_name ?? '',
    address: p.customer_address ?? '',
    title: p.title ?? 'Quote',
    number: p.proposal_number ?? '',
    scope: p.scope_of_work ?? '',
    required,
    hiddenRequiredCents,
    options,
    lines: ctx.lines.map((l) => ({ id: l.id, unit: l.unit, unit_price: l.unit_price, line_total: l.line_total, taxable: l.taxable, is_optional: l.is_optional, optional_default_on: l.optional_default_on })),
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
