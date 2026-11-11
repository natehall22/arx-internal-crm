import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeOrgSettings } from '@/lib/org-settings'
import { orgDb } from '@/lib/supabase/org-db'
import { isMissingColumn } from '@/lib/job-catch-up-db'
import { computeProposalTotals } from '@/lib/proposal-pricing-visibility'
import {
  SALES_TAX_SETTINGS_KEY,
  combinedTaxPercent,
  computeDocumentSalesTax,
  parseSalesTaxSettings,
  readSalesTaxSettings,
  taxRatesByIds,
  type SalesTaxResult,
  type SalesTaxSettings,
  type TaxDocLine,
} from '@/lib/sales-tax'

/**
 * Server side of sales tax: load a company's settings and a customer's exemption, save the owner's settings.
 * The math is lib/sales-tax.ts. Service plans: call `computeCustomerSalesTax` (or `loadSalesTaxContext` +
 * `computeDocumentSalesTax`) — never multiply a rate yourself.
 */

export async function loadOrgSalesTax(client: SupabaseClient, orgId: string): Promise<SalesTaxSettings | null> {
  const { data, error } = await client.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  if (error) throw new Error(`sales tax: read company settings: ${error.message}`)
  return readSalesTaxSettings((data as { settings?: unknown } | null)?.settings)
}

export type CustomerTaxExemption = {
  exempt: boolean
  reason: string | null
  certificateNumber: string | null
  documentId: string | null
}

const NOT_EXEMPT: CustomerTaxExemption = { exempt: false, reason: null, certificateNumber: null, documentId: null }

/** A customer's exemption. Unknown customer, no customer, or migration 202611110040 not applied = not exempt. */
export async function loadCustomerTaxExemption(
  client: SupabaseClient,
  orgId: string,
  customerId: string | null | undefined
): Promise<CustomerTaxExemption> {
  if (!customerId) return NOT_EXEMPT
  const { data, error } = await orgDb(client, orgId)
    .from('customers')
    .select('tax_exempt, tax_exempt_reason, tax_exempt_certificate_number, tax_exempt_document_id')
    .eq('id', customerId)
    .maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'tax_exempt')) return NOT_EXEMPT
    throw new Error(`sales tax: read customer exemption: ${error.message}`)
  }
  if (!data) return NOT_EXEMPT
  return {
    exempt: data.tax_exempt === true,
    reason: data.tax_exempt_reason ?? null,
    certificateNumber: data.tax_exempt_certificate_number ?? null,
    documentId: data.tax_exempt_document_id ?? null,
  }
}

export type SalesTaxContext = { settings: SalesTaxSettings | null; customerExempt: boolean }

export async function loadSalesTaxContext(
  client: SupabaseClient,
  orgId: string,
  customerId: string | null | undefined
): Promise<SalesTaxContext> {
  const [settings, exemption] = await Promise.all([
    loadOrgSalesTax(client, orgId),
    loadCustomerTaxExemption(client, orgId, customerId),
  ])
  return { settings, customerExempt: exemption.exempt }
}

/**
 * For anything billed from company settings (invoices, service plans): the company's default rates on the taxable
 * lines, nothing for an exempt customer / tax off / not set up.
 */
export async function computeCustomerSalesTax(
  client: SupabaseClient,
  orgId: string,
  customerId: string | null | undefined,
  lines: readonly TaxDocLine[],
  opts: { discountCents?: number; rateIds?: readonly string[] | null } = {}
): Promise<SalesTaxResult> {
  const ctx = await loadSalesTaxContext(client, orgId, customerId)
  return computeDocumentSalesTax({ settings: ctx.settings, lines, customerExempt: ctx.customerExempt, ...opts })
}

/** THE writer of orgs.settings.salesTax (owner save). The whole object is replaced in one per-key merge. */
export async function saveSalesTaxSettings(
  client: SupabaseClient,
  orgId: string,
  input: unknown
): Promise<{ error: string | null; value?: SalesTaxSettings }> {
  const parsed = parseSalesTaxSettings(input)
  if ('error' in parsed) return { error: parsed.error }
  // Set-up tax writes per-rate snapshots on quotes and invoices: refuse until those columns exist, so a company never
  // switches to rates while documents could only store the legacy single rate.
  if (!(await salesTaxColumnsReady(client))) {
    return { error: 'Sales tax needs a database update first (migration 202611110040). Nothing was changed.' }
  }
  const { error } = await mergeOrgSettings(client, orgId, { ...parsed.value }, { path: [SALES_TAX_SETTINGS_KEY] })
  if (error) return { error }
  return { error: null, value: parsed.value }
}

/**
 * Server check of a proposal save (builder POST/PUT). A quote that carries `tax_lines` was priced with company rates:
 * the server recomputes subtotal, discount, tax and total from the line items with the SAME helper the screen uses
 * (computeProposalTotals), the company's own rates (by id) and the customer's exemption, so stored numbers never
 * depend on what the browser sent. No `tax_lines` (or the company has not set up sales tax) = legacy single rate:
 * returns null and the save is unchanged.
 */
export async function proposalSalesTaxFields(
  client: SupabaseClient,
  orgId: string,
  proposal: Record<string, unknown>,
  lineItems: readonly Record<string, unknown>[]
): Promise<Record<string, unknown> | null> {
  // Only the chosen rate IDS are taken from the browser; names, percents and amounts come from the company's list.
  if (!Array.isArray(proposal.tax_lines)) return null
  const settings = await loadOrgSalesTax(client, orgId)
  if (!settings) return null
  const rateIds = (proposal.tax_lines as unknown[])
    .map((l) => (l && typeof l === 'object' ? (l as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const opportunityId = typeof proposal.opportunity_id === 'string' && proposal.opportunity_id ? proposal.opportunity_id : null
  let customerId: string | null = null
  if (opportunityId) {
    const { data } = await orgDb(client, orgId).from('opportunities').select('customer_id').eq('id', opportunityId).maybeSingle()
    customerId = (data as { customer_id?: string | null } | null)?.customer_id ?? null
  }
  const exemption = await loadCustomerTaxExemption(client, orgId, customerId)
  const rates = taxRatesByIds(settings, rateIds)
  const t = computeProposalTotals({
    items: lineItems.map((i) => ({
      line_total: Number(i.line_total) || 0,
      unit_price: Number(i.unit_price) || 0,
      unit: typeof i.unit === 'string' ? i.unit : null,
      price_type: typeof i.price_type === 'string' ? i.price_type : null,
      taxable: typeof i.taxable === 'boolean' ? i.taxable : null,
    })),
    discountPercent: Number(proposal.discount_percent) || 0,
    discountAmount: Number(proposal.discount_amount) || 0,
    rates,
    exempt: exemption.exempt,
  })
  return {
    subtotal: t.subtotalCents / 100,
    discount_amount: t.discountCents / 100,
    tax_rate: combinedTaxPercent(rates),
    tax_amount: t.taxCents / 100,
    total: t.totalCents / 100,
    tax_lines: t.taxLines,
    taxable_subtotal: t.taxableCents / 100,
    tax_exempt: t.exempt,
  }
}

/**
 * Has migration 202611110040 been applied (the snapshot columns on proposals and job_invoices)? The one check used by
 * the owner save and the company seed. Reads no rows. Any error other than "column missing" is thrown.
 */
export async function salesTaxColumnsReady(client: SupabaseClient): Promise<boolean> {
  for (const table of ['proposals', 'job_invoices'] as const) {
    // org-scope-ok: column probe only — limit(0) reads no rows of any company
    const { error } = await client.from(table).select('tax_lines').limit(0)
    if (isMissingColumn(error, 'tax_lines')) return false
    if (error) throw new Error(`sales tax: check ${table}.tax_lines: ${error.message}`)
  }
  return true
}
