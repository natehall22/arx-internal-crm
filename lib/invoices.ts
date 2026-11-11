import { SupabaseClient } from '@supabase/supabase-js'
import {
  JobInvoice,
  JobInvoiceItem,
  InvoicePayment,
  InvoiceWithItems,
  InvoiceItemInput,
  InvoiceBalance,
  InvoiceStatus,
  InvoiceKind,
  DepositInfo,
} from './types/invoices'
import { formatCurrency } from './job-payments'
import { isMissingColumn } from './job-catch-up-db'
import { computeCustomerSalesTax } from './sales-tax-server'
import { normalizeDepositFraction } from './job-pipeline'
import { invoiceItemLineFields, CUSTOMER_PAYMENT_METHODS, type CustomerPaymentMethod } from './invoice-lines'
export { CUSTOMER_PAYMENT_METHODS, CUSTOMER_PAYMENT_METHOD_LABELS, type CustomerPaymentMethod } from './invoice-lines'

/**
 * The ONE org check for an invoice id: returns the invoice only when it belongs to `orgId`.
 * Job invoices scope through the parent job (production_jobs.org_id, the tenant anchor that job_invoices.org_id mirrors),
 * so that works with or without migration 202611100040. Invoices without a job (recurring service, migration
 * 202611110060) carry their own org_id, set by their writer and checked by trigger against the customer; they come back
 * with `job_id: null` and their `customer_id`. Use it before any other lib/invoices call that takes an invoice id.
 */
export async function findOrgInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  orgId: string
): Promise<{ id: string; job_id: string | null; status: InvoiceStatus; customer_id?: string | null } | null> {
  if (!invoiceId || !orgId) return null
  // org-scope-ok: company filter is .eq('production_jobs.org_id', orgId) on the !inner parent-job join (works before migration 202611100040)
  const { data } = await supabase
    .from('job_invoices')
    .select('id, job_id, status, production_jobs!inner(org_id)')
    .eq('id', invoiceId)
    .eq('production_jobs.org_id', orgId)
    .maybeSingle()
  const row = data as { id: string; job_id: string; status: InvoiceStatus; production_jobs?: { org_id?: string } | null } | null
  // Re-check in code too: the embedded filter is the guard, this keeps a mis-shaped response from passing.
  if (row && row.production_jobs?.org_id === orgId) return { id: row.id, job_id: row.job_id, status: row.status }
  if (row) return null
  // An invoice without a job. Before migration 202611110060 none exist (and customer_id is not a column): the read errors → null.
  const { data: own, error } = await supabase
    .from('job_invoices')
    .select('id, job_id, status, org_id, customer_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .is('job_id', null)
    .maybeSingle()
  const o = own as { id: string; job_id: string | null; status: InvoiceStatus; org_id?: string; customer_id?: string | null } | null
  if (error || !o || o.job_id != null || o.org_id !== orgId || !o.customer_id) return null
  return { id: o.id, job_id: null, status: o.status, customer_id: o.customer_id }
}

/**
 * Get all active (non-void) invoices for a job
 */
export async function getActiveInvoices(
  supabase: SupabaseClient,
  jobId: string
): Promise<JobInvoice[]> {
  // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
  const { data, error } = await supabase
    .from('job_invoices')
    .select('*')
    .eq('job_id', jobId)
    .neq('status', 'void')
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Failed to get invoices: ${error.message}`)
  }

  return (data || []) as JobInvoice[]
}

/**
 * Check if an active deposit invoice exists for a job
 */
export async function hasActiveDepositInvoice(
  supabase: SupabaseClient,
  jobId: string
): Promise<boolean> {
  // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
  const { data, error } = await supabase
    .from('job_invoices')
    .select('id')
    .eq('job_id', jobId)
    .eq('invoice_kind', 'deposit')
    .neq('status', 'void')
    .limit(1)

  if (error) {
    console.error('Error checking deposit invoice:', error)
    return false
  }

  return (data?.length || 0) > 0
}

/**
 * Get deposit information for a job including payments and invoice status
 */
export async function getDepositInfo(
  supabase: SupabaseClient,
  jobId: string
): Promise<DepositInfo> {
  // Get job sale amount and deposit percent
  // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
  const { data: job } = await supabase
    .from('production_jobs')
    .select('sale_amount, deposit_required_percent')
    .eq('id', jobId)
    .single()

  const saleAmountCents = Math.round((job?.sale_amount || 0) * 100)
  const depositPercent = normalizeDepositFraction(job?.deposit_required_percent) ?? 0.5
  const requiredDepositCents = Math.round(saleAmountCents * depositPercent)

  // Get all deposit payments
  // org-scope-ok: job_payments gained org_id only for payments without a job (202611110060); jobId was verified in the caller's company
  const { data: payments } = await supabase
    .from('job_payments')
    .select('id, amount_cents')
    .eq('job_id', jobId)
    .eq('payment_type', 'deposit')

  const depositPayments = (payments || []).filter(p => p.amount_cents > 0)
  const totalDepositCents = depositPayments.reduce((sum, p) => sum + p.amount_cents, 0)

  // Check for active deposit invoice
  // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
  const { data: depositInvoices } = await supabase
    .from('job_invoices')
    .select('id, total_cents')
    .eq('job_id', jobId)
    .eq('invoice_kind', 'deposit')
    .neq('status', 'void')

  const hasActiveDepositInvoice = (depositInvoices?.length || 0) > 0

  // Get total applied to deposit invoices
  let appliedDepositCents = 0
  if (depositInvoices && depositInvoices.length > 0) {
    const invoiceIds = depositInvoices.map(i => i.id)
    const { data: appliedPayments } = await supabase
      .from('invoice_payments')
      .select('applied_cents')
      .in('invoice_id', invoiceIds)

    appliedDepositCents = (appliedPayments || []).reduce((sum, p) => sum + p.applied_cents, 0)
  }

  return {
    hasDeposit: depositPayments.length > 0,
    depositPayments,
    totalDepositCents,
    saleAmountCents,
    requiredDepositCents,
    hasActiveDepositInvoice,
    appliedDepositCents,
  }
}

/**
 * Create a new invoice for a job.
 * If defaultFromJobTotal is true, creates a single line item from job's sale_amount.
 */
export async function createInvoiceForJob(
  supabase: SupabaseClient,
  jobId: string,
  createdBy: string,
  defaultFromJobTotal: boolean = false
): Promise<JobInvoice> {
  // Create the invoice (invoice_number auto-generated by trigger)
  const { data: invoice, error: invoiceError } = await supabase
    .from('job_invoices')
    .insert({
      job_id: jobId,
      created_by: createdBy,
      status: 'draft',
    })
    .select()
    .single()

  if (invoiceError || !invoice) {
    throw new Error(`Failed to create invoice: ${invoiceError?.message || 'Unknown error'}`)
  }

  // If requested, add default line item from job total
  if (defaultFromJobTotal) {
    // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
    const { data: job } = await supabase
      .from('production_jobs')
      .select('sale_amount, job_type, job_source')
      .eq('id', jobId)
      .single()

    if (job?.sale_amount) {
      const saleAmountCents = Math.round(job.sale_amount * 100)
      await addInvoiceItem(supabase, invoice.id, {
        description:
          job.job_source === 'insurance'
            ? `${job.job_type || 'Roofing'} - Insurance Claim Amount`
            : `${job.job_type || 'Roofing'} - Per Contract`,
        qty: 1,
        unit_price_cents: saleAmountCents,
      })

      // Refresh invoice to get updated totals
      const { data: refreshed } = await supabase
        .from('job_invoices')
        .select()
        .eq('id', invoice.id)
        .single()

      if (refreshed) return refreshed as JobInvoice
    }
  }

  return invoice as JobInvoice
}

/**
 * Sum of non-void invoices for a job, BEFORE invoice sales tax (used for remaining-balance checks).
 * Rule (lib/sales-tax.ts): `sale_amount` is the signed contract (+ COs) and never includes tax an invoice adds on
 * taxable lines; that tax is billed on top. So contract-balance checks compare pre-tax amounts: a taxed invoice uses
 * up only its pre-tax amount of the contract. Companies with no invoice tax get the old total sum.
 */
export async function getTotalInvoicedCentsForJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<number> {
  // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
  const first = await supabase
    .from('job_invoices')
    .select('total_cents, tax_cents')
    .eq('job_id', jobId)
    .neq('status', 'void')
  let rows = first.data as Array<{ total_cents: number | null; tax_cents?: number | null }> | null
  if (isMissingColumn(first.error, 'tax_cents')) {
    // org-scope-ok: same job as above; before migration 202611110040 there is no invoice tax
    const { data } = await supabase.from('job_invoices').select('total_cents').eq('job_id', jobId).neq('status', 'void')
    rows = data as Array<{ total_cents: number | null }> | null
  }
  return invoicedPreTaxCents(rows || [])
}

/** Pure: pre-tax invoiced cents (total − invoice tax) over non-void invoices already filtered by the caller. */
export function invoicedPreTaxCents(rows: Array<{ total_cents: number | null; tax_cents?: number | null }>): number {
  return rows.reduce((sum, r) => sum + (r.total_cents || 0) - (r.tax_cents || 0), 0)
}

/**
 * Create a standard invoice with a single line at a custom amount (e.g. progress billing).
 * Amount cannot exceed remaining contract balance when the job has a positive sale amount.
 */
export async function createCustomAmountInvoice(
  supabase: SupabaseClient,
  jobId: string,
  createdBy: string,
  amountCents: number,
  lineDescription?: string | null
): Promise<JobInvoice> {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be greater than zero')
  }

  // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
  const { data: job } = await supabase
    .from('production_jobs')
    .select('sale_amount, job_type, job_source')
    .eq('id', jobId)
    .single()

  const saleAmountCents = Math.round((job?.sale_amount || 0) * 100)
  const isInsuranceJob = job?.job_source === 'insurance'

  if (saleAmountCents > 0) {
    const maxAllowed = isInsuranceJob
      ? saleAmountCents
      : saleAmountCents - (await getTotalInvoicedCentsForJob(supabase, jobId))
    if (amountCents > maxAllowed) {
      throw new Error(
        isInsuranceJob
          ? `Amount exceeds full contract amount (${formatCurrency(saleAmountCents)})`
          : `Amount exceeds remaining contract balance (${formatCurrency(Math.max(0, maxAllowed))} available of ${formatCurrency(saleAmountCents)} contract)`
      )
    }
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from('job_invoices')
    .insert({
      job_id: jobId,
      created_by: createdBy,
      status: 'draft',
      invoice_kind: 'standard',
    })
    .select()
    .single()

  if (invoiceError || !invoice) {
    throw new Error(`Failed to create invoice: ${invoiceError?.message || 'Unknown error'}`)
  }

  const defaultDesc =
    job?.job_source === 'insurance'
      ? `${job?.job_type || 'Roofing'} - Insurance Claim Amount`
      : `${job?.job_type || 'Roofing'} - Per Contract`
  const description = lineDescription?.trim() || defaultDesc

  await addInvoiceItem(supabase, invoice.id, {
    description,
    qty: 1,
    unit_price_cents: amountCents,
  })

  const { data: refreshed } = await supabase
    .from('job_invoices')
    .select()
    .eq('id', invoice.id)
    .single()

  return (refreshed || invoice) as JobInvoice
}

/**
 * Create a deposit invoice for a job.
 * - Checks for existing active deposit invoice (prevents duplicates)
 * - Creates invoice with deposit amount
 * - Adds single line item "Deposit (50%)"
 * - Auto-applies all deposit payments
 * - Sets status based on applied vs total
 */
export async function createDepositInvoiceV2(
  supabase: SupabaseClient,
  jobId: string,
  createdBy: string
): Promise<JobInvoice> {
  // Check for existing active deposit invoice
  const hasExisting = await hasActiveDepositInvoice(supabase, jobId)
  if (hasExisting) {
    throw new Error('An active deposit invoice already exists for this job')
  }

  // Get deposit info
  const depositInfo = await getDepositInfo(supabase, jobId)
  
  if (!depositInfo.hasDeposit) {
    throw new Error('No deposit payments found for this job')
  }

  // Use total deposit payments as invoice amount (or required deposit, whichever is less)
  const invoiceAmountCents = Math.min(
    depositInfo.totalDepositCents,
    depositInfo.requiredDepositCents
  )

  // Create the invoice with kind = 'deposit'
  const { data: invoice, error: invoiceError } = await supabase
    .from('job_invoices')
    .insert({
      job_id: jobId,
      created_by: createdBy,
      status: 'draft',
      invoice_kind: 'deposit',
      subtotal_cents: invoiceAmountCents,
      total_cents: invoiceAmountCents,
      issued_at: new Date().toISOString().split('T')[0],
      public_note: 'Remaining balance due at installation.',
    })
    .select()
    .single()

  if (invoiceError || !invoice) {
    throw new Error(`Failed to create invoice: ${invoiceError?.message || 'Unknown error'}`)
  }

  // Add deposit line item
  const depositPercent = Math.round((invoiceAmountCents / depositInfo.saleAmountCents) * 100)
  const { error: itemError } = await supabase
    .from('job_invoice_items')
    .insert({
      invoice_id: invoice.id,
      description: `Deposit (${depositPercent}%)`,
      qty: 1,
      unit_price_cents: invoiceAmountCents,
      line_total_cents: invoiceAmountCents,
      sort_order: 0,
    })

  if (itemError) {
    throw new Error(`Failed to add deposit item: ${itemError.message}`)
  }

  // Auto-apply all deposit payments
  let totalApplied = 0
  for (const payment of depositInfo.depositPayments) {
    const amountToApply = Math.min(payment.amount_cents, invoiceAmountCents - totalApplied)
    if (amountToApply <= 0) break

    const { error: paymentError } = await supabase
      .from('invoice_payments')
      .insert({
        invoice_id: invoice.id,
        job_payment_id: payment.id,
        applied_cents: amountToApply,
      })

    if (paymentError) {
      console.error('Failed to apply payment:', paymentError)
    } else {
      totalApplied += amountToApply
    }
  }

  // Determine status based on applied amount
  const newStatus: InvoiceStatus = totalApplied >= invoiceAmountCents 
    ? 'paid' 
    : totalApplied > 0 
      ? 'partially_paid' 
      : 'sent'

  // Update invoice status
  const { data: finalInvoice, error: finalError } = await supabase
    .from('job_invoices')
    .update({ status: newStatus })
    .eq('id', invoice.id)
    .select()
    .single()

  if (finalError || !finalInvoice) {
    throw new Error(`Failed to finalize invoice: ${finalError?.message || 'Unknown error'}`)
  }

  return finalInvoice as JobInvoice
}

/**
 * Create a final invoice for a job (remaining balance after deposit).
 * - total = sale_amount - applied_deposit_total
 * - Line item: "Remaining Balance"
 */
export async function createFinalInvoice(
  supabase: SupabaseClient,
  jobId: string,
  createdBy: string
): Promise<JobInvoice> {
  // Get deposit info to calculate remaining balance
  const depositInfo = await getDepositInfo(supabase, jobId)
  
  // Final invoice amount = sale amount - deposit already invoiced/applied
  const finalAmountCents = depositInfo.saleAmountCents - depositInfo.appliedDepositCents

  if (finalAmountCents <= 0) {
    throw new Error('No remaining balance to invoice')
  }

  // Create the invoice with kind = 'final'
  const { data: invoice, error: invoiceError } = await supabase
    .from('job_invoices')
    .insert({
      job_id: jobId,
      created_by: createdBy,
      status: 'draft',
      invoice_kind: 'final',
      subtotal_cents: finalAmountCents,
      total_cents: finalAmountCents,
      public_note: 'Payment due upon completion.',
    })
    .select()
    .single()

  if (invoiceError || !invoice) {
    throw new Error(`Failed to create invoice: ${invoiceError?.message || 'Unknown error'}`)
  }

  // Add line item for remaining balance
  const { error: itemError } = await supabase
    .from('job_invoice_items')
    .insert({
      invoice_id: invoice.id,
      description: 'Remaining Balance - Per Contract',
      qty: 1,
      unit_price_cents: finalAmountCents,
      line_total_cents: finalAmountCents,
      sort_order: 0,
    })

  if (itemError) {
    throw new Error(`Failed to add line item: ${itemError.message}`)
  }

  return invoice as JobInvoice
}

/**
 * Add a line item to a draft invoice.
 * Automatically recalculates invoice totals.
 */
export async function addInvoiceItem(
  supabase: SupabaseClient,
  invoiceId: string,
  item: InvoiceItemInput
): Promise<JobInvoiceItem> {
  const lineFields = invoiceItemLineFields(item)
  if ('error' in lineFields) throw new Error(lineFields.error)
  // Verify invoice is draft
  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: invoice } = await supabase
    .from('job_invoices')
    .select('status')
    .eq('id', invoiceId)
    .single()

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  if (invoice.status !== 'draft') {
    throw new Error('Cannot add items to non-draft invoice. Create a new invoice instead.')
  }

  const qty = item.qty ?? 1
  const lineTotalCents = Math.round(qty * item.unit_price_cents)

  // Get current max sort_order
  const { data: maxOrder } = await supabase
    .from('job_invoice_items')
    .select('sort_order')
    .eq('invoice_id', invoiceId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const sortOrder = item.sort_order ?? ((maxOrder?.sort_order ?? -1) + 1)

  const { data: newItem, error } = await supabase
    .from('job_invoice_items')
    .insert({
      invoice_id: invoiceId,
      description: item.description,
      qty,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: lineTotalCents,
      sort_order: sortOrder,
      // Sales tax: only sent when the line is taxable, so an untaxed line still saves before migration 202611110040.
      ...(item.taxable === true ? { taxable: true } : {}),
      // Hours / service day / visit links: only sent when set, so a plain line saves before migration 202611110060.
      ...lineFields.value,
    })
    .select()
    .single()

  if (error || !newItem) {
    throw new Error(`Failed to add invoice item: ${error?.message || 'Unknown error'}`)
  }

  // Recalculate invoice totals
  await recalculateInvoiceTotals(supabase, invoiceId)

  return newItem as JobInvoiceItem
}

/**
 * Update a line item on a draft invoice. `invoiceId` must be an invoice the caller already verified
 * (job_invoice_items has no org_id; the invoice is the tenant anchor).
 */
export async function updateInvoiceItem(
  supabase: SupabaseClient,
  invoiceId: string,
  itemId: string,
  updates: Partial<InvoiceItemInput>
): Promise<JobInvoiceItem> {
  // Get current item
  const { data: currentItem } = await supabase
    .from('job_invoice_items')
    .select('*, job_invoices!inner(status)')
    .eq('id', itemId)
    .eq('invoice_id', invoiceId)
    .maybeSingle()

  if (!currentItem) {
    throw new Error('Invoice item not found')
  }

  if ((currentItem as any).job_invoices?.status !== 'draft') {
    throw new Error('Cannot update items on non-draft invoice')
  }

  const lineFields = invoiceItemLineFields({ ...updates, qty: updates.qty ?? currentItem.qty, unit: updates.unit === undefined ? currentItem.unit : updates.unit })
  if ('error' in lineFields) throw new Error(lineFields.error)
  const qty = updates.qty ?? currentItem.qty
  const unitPriceCents = updates.unit_price_cents ?? currentItem.unit_price_cents
  const lineTotalCents = Math.round(qty * unitPriceCents)

  const { data: updated, error } = await supabase
    .from('job_invoice_items')
    .update({
      description: updates.description ?? currentItem.description,
      qty,
      unit_price_cents: unitPriceCents,
      line_total_cents: lineTotalCents,
      sort_order: updates.sort_order ?? currentItem.sort_order,
      ...(typeof updates.taxable === 'boolean' ? { taxable: updates.taxable } : {}),
      ...(updates.unit !== undefined ? { unit: updates.unit ?? null } : {}),
      ...(updates.service_date !== undefined ? { service_date: updates.service_date ?? null } : {}),
    })
    .eq('id', itemId)
    .eq('invoice_id', invoiceId)
    .select()
    .single()

  if (error || !updated) {
    throw new Error(`Failed to update invoice item: ${error?.message || 'Unknown error'}`)
  }

  // Recalculate invoice totals
  await recalculateInvoiceTotals(supabase, currentItem.invoice_id)

  return updated as JobInvoiceItem
}

/**
 * Delete a line item from a draft invoice. `invoiceId` must be an invoice the caller already verified.
 */
export async function deleteInvoiceItem(
  supabase: SupabaseClient,
  invoiceId: string,
  itemId: string
): Promise<void> {
  const { data: item } = await supabase
    .from('job_invoice_items')
    .select('invoice_id, job_invoices!inner(status)')
    .eq('id', itemId)
    .eq('invoice_id', invoiceId)
    .maybeSingle()

  if (!item) {
    throw new Error('Invoice item not found')
  }

  if ((item as any).job_invoices?.status !== 'draft') {
    throw new Error('Cannot delete items from non-draft invoice')
  }

  const { error } = await supabase
    .from('job_invoice_items')
    .delete()
    .eq('id', itemId)
    .eq('invoice_id', invoiceId)

  if (error) {
    throw new Error(`Failed to delete invoice item: ${error.message}`)
  }

  await recalculateInvoiceTotals(supabase, item.invoice_id)
}

/**
 * Recalculate invoice subtotal, sales tax and total from line items (draft invoices only reach here).
 * Tax (lib/sales-tax.ts, computeCustomerSalesTax): the company's default rates on lines marked `taxable`, nothing for a
 * tax-exempt customer or a company that charges no tax / has not set up sales tax. Lines are NOT taxable unless marked:
 * contract, deposit and balance lines bill an already tax-included sale amount. Before migration 202611110040 the
 * invoice is totalled exactly as before (no tax).
 */
export async function recalculateInvoiceTotals(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<void> {
  type ItemRow = { line_total_cents: number; taxable?: boolean | null }
  const first = await supabase.from('job_invoice_items').select('line_total_cents, taxable').eq('invoice_id', invoiceId)
  const taxReady = !isMissingColumn(first.error, 'taxable')
  // A failed read must not total the invoice as $0.
  if (first.error && taxReady) throw new Error(`Failed to read invoice items: ${first.error.message}`)
  const items = taxReady
    ? first.data
    : (await supabase.from('job_invoice_items').select('line_total_cents').eq('invoice_id', invoiceId)).data
  const rows = (items || []) as ItemRow[]
  const subtotalCents = rows.reduce((sum, item) => sum + item.line_total_cents, 0)

  let update: Record<string, unknown> = { subtotal_cents: subtotalCents, total_cents: subtotalCents }
  if (taxReady) {
    // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); the job is the invoice's own parent
    const { data: inv } = await supabase.from('job_invoices').select('job_id').eq('id', invoiceId).maybeSingle()
    // org-scope-ok: job_id comes from the invoice verified above; org_id is read off the job itself, not from the request
    const { data: job } = inv?.job_id
      ? await supabase.from('production_jobs').select('org_id, customer_id').eq('id', inv.job_id).maybeSingle()
      : inv
        ? // An invoice without a job (migration 202611110060) is its own anchor: its org and customer.
          // org-scope-ok: invoiceId was verified in the caller's company (findOrgInvoice / create_service_invoice); these are the invoice's own columns
          await supabase.from('job_invoices').select('org_id, customer_id').eq('id', invoiceId).is('job_id', null).maybeSingle()
        : { data: null }
    const tax = job?.org_id
      ? await computeCustomerSalesTax(
          supabase,
          job.org_id,
          job.customer_id ?? null,
          rows.map((r) => ({ amountCents: r.line_total_cents, taxable: r.taxable === true }))
        )
      : null
    update = {
      subtotal_cents: subtotalCents,
      taxable_subtotal_cents: tax?.taxableCents ?? 0,
      tax_cents: tax?.taxCents ?? 0,
      tax_lines: tax?.taxLines ?? [],
      total_cents: subtotalCents + (tax?.taxCents ?? 0),
    }
  }

  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { error: updateError } = await supabase
    .from('job_invoices')
    .update(update)
    .eq('id', invoiceId)
  // A failed total write must not leave the invoice showing old totals silently.
  if (updateError) throw new Error(`Failed to save invoice totals: ${updateError.message}`)
}

/**
 * Finalize and send an invoice.
 * Sets status to 'sent', records sent_at and email.
 * PDF generation is handled separately via the /api/invoices/[id]/pdf endpoint.
 * Email sending is not implemented here. Nothing is sent to QuickBooks (see docs/quickbooks-sync.md).
 */
export async function finalizeAndSendInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  email: string
): Promise<JobInvoice> {
  // Verify invoice exists and is draft
  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: invoice } = await supabase
    .from('job_invoices')
    .select('*, job_invoice_items(*)')
    .eq('id', invoiceId)
    .single()

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  if (invoice.status !== 'draft') {
    throw new Error('Only draft invoices can be sent')
  }

  if (!invoice.job_invoice_items || invoice.job_invoice_items.length === 0) {
    throw new Error('Cannot send invoice with no line items')
  }

  if (invoice.total_cents <= 0) {
    throw new Error('Cannot send invoice with zero total')
  }

  const now = new Date().toISOString()
  const today = now.split('T')[0]

  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: updated, error } = await supabase
    .from('job_invoices')
    .update({
      status: 'sent',
      issued_at: today,
      due_at: invoice.due_at || today,
      sent_at: now,
      sent_to_email: email,
    })
    .eq('id', invoiceId)
    .select()
    .single()

  if (error || !updated) {
    throw new Error(`Failed to send invoice: ${error?.message || 'Unknown error'}`)
  }

  // TODO: Integrate with email service to actually send the invoice
  console.log(`[STUB] Invoice ${updated.invoice_number} sent to ${email}`)

  return updated as JobInvoice
}

/**
 * Apply a job payment to an invoice.
 * Automatically updates invoice status based on payment coverage.
 */
export async function applyPaymentToInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  jobPaymentId: string,
  appliedCents: number,
  createdBy?: string
): Promise<InvoicePayment> {
  if (appliedCents <= 0) {
    throw new Error('Applied amount must be positive')
  }

  // Verify invoice exists and is not void/draft
  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: invoice } = await supabase
    .from('job_invoices')
    .select('status, total_cents, job_id')
    .eq('id', invoiceId)
    .single()

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  if (invoice.status === 'void') {
    throw new Error('Cannot apply payment to voided invoice')
  }

  if (invoice.status === 'draft') {
    throw new Error('Cannot apply payment to draft invoice. Send it first.')
  }

  // An invoice without a job is paid through recordCustomerInvoicePayment (its payment has no job to match on).
  if (!invoice.job_id) {
    throw new Error('Payment not found')
  }

  // Verify payment exists and belongs to same job
  const { data: payment } = await supabase
    // org-scope-ok: job_payments gained org_id only for payments without a job (202611110060); the payment must belong to the invoice's own job (checked just below), and the invoice was verified by findOrgInvoice
    .from('job_payments')
    .select('id, amount_cents, job_id')
    .eq('id', jobPaymentId)
    .single()

  // The payment id comes from the request body: it must be a payment on THIS invoice's job (otherwise any job's,
  // including another company's, payment could be applied here).
  if (!payment || payment.job_id !== invoice.job_id) {
    throw new Error('Payment not found')
  }

  // Check payment isn't already fully applied
  const { data: existingApplications } = await supabase
    .from('invoice_payments')
    .select('applied_cents')
    .eq('job_payment_id', jobPaymentId)

  const totalApplied = (existingApplications || []).reduce((sum, a) => sum + a.applied_cents, 0)
  const remainingPayment = payment.amount_cents - totalApplied

  if (appliedCents > remainingPayment) {
    throw new Error(`Cannot apply ${appliedCents} cents. Only ${remainingPayment} cents remaining from this payment.`)
  }

  // Create the application
  const { data: application, error } = await supabase
    .from('invoice_payments')
    .insert({
      invoice_id: invoiceId,
      job_payment_id: jobPaymentId,
      applied_cents: appliedCents,
      created_by: createdBy,
    })
    .select()
    .single()

  if (error || !application) {
    throw new Error(`Failed to apply payment: ${error?.message || 'Unknown error'}`)
  }

  // Update invoice status based on total applied
  await updateInvoicePaymentStatus(supabase, invoiceId)

  return application as InvoicePayment
}

/**
 * Update invoice status based on applied payments.
 */
async function updateInvoicePaymentStatus(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<void> {
  const balance = await computeInvoiceBalance(supabase, invoiceId)

  let newStatus: InvoiceStatus
  if (balance.is_paid) {
    newStatus = 'paid'
  } else if (balance.applied_cents > 0) {
    newStatus = 'partially_paid'
  } else {
    newStatus = 'sent' // Keep as sent if no payments
  }

  // Only update if status would change (and not void)
  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: current } = await supabase
    .from('job_invoices')
    .select('status')
    .eq('id', invoiceId)
    .single()

  if (current && current.status !== 'void' && current.status !== newStatus) {
    // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
    await supabase
      .from('job_invoices')
      .update({ status: newStatus })
      .eq('id', invoiceId)
  }
}

/**
 * Compute the balance for an invoice.
 */
export async function computeInvoiceBalance(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<InvoiceBalance> {
  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: invoice } = await supabase
    .from('job_invoices')
    .select('total_cents')
    .eq('id', invoiceId)
    .single()

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  const { data: applications } = await supabase
    .from('invoice_payments')
    .select('applied_cents')
    .eq('invoice_id', invoiceId)

  const appliedCents = (applications || []).reduce((sum, a) => sum + a.applied_cents, 0)
  const balanceCents = invoice.total_cents - appliedCents

  return {
    total_cents: invoice.total_cents,
    applied_cents: appliedCents,
    balance_cents: balanceCents,
    is_paid: balanceCents <= 0,
  }
}

/**
 * Get invoice with all items and payments.
 */
export async function getInvoiceWithDetails(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<InvoiceWithItems | null> {
  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: invoice } = await supabase
    .from('job_invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()

  if (!invoice) return null

  const { data: items } = await supabase
    .from('job_invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('sort_order', { ascending: true })

  const { data: payments } = await supabase
    .from('invoice_payments')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true })

  const appliedCents = (payments || []).reduce((sum, p) => sum + p.applied_cents, 0)

  return {
    ...invoice,
    items: items || [],
    payments: payments || [],
    applied_cents: appliedCents,
    balance_cents: invoice.total_cents - appliedCents,
  } as InvoiceWithItems
}

/**
 * Get all invoices for a job.
 */
export async function getInvoicesForJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<JobInvoice[]> {
  // org-scope-ok: jobId was verified in the caller's company (app/api/ops/jobs/[id]/invoices: production_jobs id + org_id); job_invoices.org_id filter after migration 202611100040
  const { data, error } = await supabase
    .from('job_invoices')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch invoices: ${error.message}`)
  }

  return (data || []) as JobInvoice[]
}

/**
 * Void an invoice.
 */
export async function voidInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  reason: string
): Promise<JobInvoice> {
  if (!reason.trim()) {
    throw new Error('Void reason is required')
  }

  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: invoice } = await supabase
    .from('job_invoices')
    .select('status')
    .eq('id', invoiceId)
    .single()

  if (!invoice) {
    throw new Error('Invoice not found')
  }

  if (invoice.status === 'void') {
    throw new Error('Invoice is already voided')
  }

  if (invoice.status === 'paid') {
    throw new Error('Cannot void a paid invoice. Refund payments first.')
  }

  // An invoice without a job with money on it stays (the DB refuses too: job_invoices_void_guard).
  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice; invoice_payments hang off it
  const { data: applied } = await supabase.from('invoice_payments').select('id').eq('invoice_id', invoiceId).limit(1)
  // org-scope-ok: same verified invoice
  const { data: owner } = await supabase.from('job_invoices').select('job_id').eq('id', invoiceId).maybeSingle()
  if (owner && !owner.job_id && (applied ?? []).length > 0) {
    throw new Error("This invoice has a payment on it, so it can't be voided.")
  }

  // org-scope-ok: invoiceId was verified in the caller's company by findOrgInvoice (app/api/invoices/[invoiceId]/*); job_invoices.org_id filter after migration 202611100040
  const { data: updated, error } = await supabase
    .from('job_invoices')
    .update({
      status: 'void',
      voided_at: new Date().toISOString(),
      void_reason: reason.trim(),
    })
    .eq('id', invoiceId)
    .select()
    .single()

  if (error || !updated) {
    throw new Error(`Failed to void invoice: ${error?.message || 'Unknown error'}`)
  }

  return updated as JobInvoice
}

/**
 * Duplicate an invoice as a new draft.
 * Useful when needing to revise a sent invoice.
 */
export async function duplicateInvoiceAsDraft(
  supabase: SupabaseClient,
  invoiceId: string,
  createdBy: string
): Promise<JobInvoice> {
  const original = await getInvoiceWithDetails(supabase, invoiceId)
  if (!original) {
    throw new Error('Invoice not found')
  }

  // An invoice without a job holds visits / plan-months: its copy goes through the ONE writer of billed lines, which
  // refuses while the original (or any other live invoice) still holds them — void the original first, then copy it.
  if (!original.job_id) {
    if (!original.org_id || !original.customer_id) throw new Error('Invoice not found')
    const made = await createServiceInvoiceFromLines(supabase, original.org_id, {
      customerId: original.customer_id,
      propertyId: original.property_id ?? null,
      createdBy,
      publicNote: original.public_note,
      internalNote: original.internal_note,
      lines: original.items.map((item) => ({
        description: item.description,
        qty: Number(item.qty),
        unit_price_cents: item.unit_price_cents,
        taxable: item.taxable === true,
        ...(item.work_order_id ? { work_order_id: item.work_order_id } : {}),
        ...(item.service_date ? { service_date: item.service_date } : {}),
        ...(item.service_plan_id ? { service_plan_id: item.service_plan_id } : {}),
        ...(item.billing_month ? { billing_month: item.billing_month } : {}),
        ...(item.unit ? { unit: item.unit } : {}),
      })),
    })
    if (!made.invoiceId) throw new Error(`Void ${original.invoice_number} first — its visits are still billed on it. Then make the copy.`)
    // org-scope-ok: the invoice was just created in original.org_id by create_service_invoice
    const { data: copy } = await supabase.from('job_invoices').select().eq('id', made.invoiceId).eq('org_id', original.org_id).single()
    return copy as JobInvoice
  }

  // Create new invoice on the same job.
  const { data: newInvoice, error: invoiceError } = await supabase
    .from('job_invoices')
    .insert({
      job_id: original.job_id,
      created_by: createdBy,
      status: 'draft',
      notes: original.notes,
      public_note: original.public_note,
      internal_note: original.internal_note,
      due_at: original.due_at,
    })
    .select()
    .single()

  if (invoiceError || !newInvoice) {
    throw new Error(`Failed to duplicate invoice: ${invoiceError?.message || 'Unknown error'}`)
  }

  // Copy line items (job invoices: never visit links — those only exist on invoices without a job).
  for (const item of original.items) {
    await addInvoiceItem(supabase, newInvoice.id, {
      description: item.description,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
      sort_order: item.sort_order,
      taxable: item.taxable === true,
      ...(item.unit ? { unit: item.unit } : {}),
      ...(item.service_date ? { service_date: item.service_date } : {}),
    })
  }

  // Refresh to get updated totals
  const { data: refreshed } = await supabase
    .from('job_invoices')
    .select()
    .eq('id', newInvoice.id)
    .single()

  return (refreshed || newInvoice) as JobInvoice
}

/** A line on an invoice without a job, as create_service_invoice takes it. */
export type ServiceInvoiceLine = {
  description: string
  qty: number
  unit_price_cents: number
  taxable: boolean
  work_order_id?: string
  service_date?: string
  service_plan_id?: string
  billing_month?: string
  unit?: 'hour'
}

/**
 * THE way an invoice without a job is made (Ready to bill, a copy of a voided one): the lines + their totals (the ONE tax
 * calculation, lib/sales-tax.ts, by this customer) go to SQL create_service_invoice in ONE call — all or nothing, so no
 * $0 invoice ever holds visits. `invoiceId: null` = something on it is already billed on a live invoice (`skipped`).
 */
export async function createServiceInvoiceFromLines(
  supabase: SupabaseClient,
  orgId: string,
  p: { customerId: string; propertyId: string | null; createdBy: string | null; lines: ServiceInvoiceLine[]; publicNote?: string | null; internalNote?: string | null }
): Promise<{ invoiceId: string | null; skipped: unknown[] }> {
  const tax = await computeCustomerSalesTax(
    supabase,
    orgId,
    p.customerId,
    p.lines.map((l) => ({ amountCents: Math.round(l.qty * l.unit_price_cents), taxable: l.taxable === true }))
  )
  const { data, error } = await supabase.rpc('create_service_invoice', {
    p_org: orgId,
    p_customer: p.customerId,
    p_property: p.propertyId,
    p_created_by: p.createdBy,
    p_lines: p.lines,
    p_totals: {
      subtotal_cents: tax.subtotalCents,
      taxable_subtotal_cents: tax.taxableCents,
      tax_cents: tax.taxCents,
      tax_lines: tax.taxLines,
      total_cents: tax.subtotalCents + tax.taxCents,
    },
    p_public_note: p.publicNote ?? null,
    p_internal_note: p.internalNote ?? null,
  })
  if (error) throw new Error(`Failed to create invoice: ${error.message}`)
  const r = (data ?? {}) as { invoice_id?: string | null; skipped?: unknown[] }
  return { invoiceId: r.invoice_id ?? null, skipped: r.skipped ?? [] }
}

export type CustomerInvoicePayment = {
  amountCents: number
  /** YYYY-MM-DD, the day the money came in. */
  paidAt: string
  method: CustomerPaymentMethod
  note?: string | null
  createdBy: string | null
}

export type RecordPaymentResult =
  | { ok: true; paymentId: string; status: InvoiceStatus; balanceCents: number }
  | { ok: false; status: 400 | 404; error: string }

/**
 * THE way money is recorded on an invoice without a job (recurring service): "Mark paid" today; a card processor's
 * webhook later calls this same function (method 'card', the processor's reference in `note`) — never a second writer.
 * One SQL transaction (record_customer_invoice_payment, migration 202611110060) with the invoice locked: a job_payments
 * row (job_id NULL, org + customer) + its invoice_payments application + the invoice status. Never more than the balance;
 * a draft is issued on the spot (paid at the door). Job invoices keep the job payment flow (applyPaymentToInvoice).
 */
export async function recordCustomerInvoicePayment(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string,
  p: CustomerInvoicePayment
): Promise<RecordPaymentResult> {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return { ok: false, status: 400, error: 'Enter an amount above zero' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) || Number.isNaN(Date.parse(`${p.paidAt}T12:00:00Z`))) return { ok: false, status: 400, error: 'Pick the day it was paid' }
  if (!(CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(p.method)) return { ok: false, status: 400, error: 'Pick how it was paid' }
  const note = typeof p.note === 'string' ? p.note.trim().slice(0, 500) : null
  const { data, error } = await supabase.rpc('record_customer_invoice_payment', {
    p_org: orgId,
    p_invoice: invoiceId,
    p_amount_cents: p.amountCents,
    p_paid_at: p.paidAt,
    p_method: p.method,
    p_note: note || null,
    p_created_by: p.createdBy,
  })
  if (error) {
    if (error.code === 'P0002') return { ok: false, status: 404, error: 'Invoice not found' }
    if (error.code === '22023') return { ok: false, status: 400, error: error.message }
    throw new Error(`Failed to record payment: ${error.message}`)
  }
  const r = (data ?? {}) as { payment_id?: string; status?: InvoiceStatus; balance_cents?: number }
  return { ok: true, paymentId: String(r.payment_id), status: (r.status ?? 'partially_paid') as InvoiceStatus, balanceCents: Number(r.balance_cents ?? 0) }
}

/**
 * Format cents as currency string.
 */
export function formatInvoiceCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}
