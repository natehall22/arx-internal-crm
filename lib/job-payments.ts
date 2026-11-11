import { SupabaseClient } from '@supabase/supabase-js'
import { JobPayment, JobPaymentSummary, JobPaymentInsert } from './types/job-payments'
import { evaluateJobCollection, JOB_COLLECTION_COLUMNS } from './job-collection'
import { loadInvoiceTaxCentsByJob } from './job-invoice-tax'

/**
 * Fetch all payments for a job (ordered by date)
 */
export async function getPaymentsByJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<JobPayment[]> {
  // org-scope-ok: job_payments gained org_id only for payments without a job (202611110060); jobId was verified in the caller's company
  const { data: payments, error } = await supabase
    .from('job_payments')
    .select('*')
    .eq('job_id', jobId)
    .order('paid_at', { ascending: true })

  if (error) {
    console.error('Error fetching payments:', error)
    return []
  }

  return (payments || []) as JobPayment[]
}

/**
 * Fetch all payments for a job and calculate summary. "Paid in full" comes from the one
 * rule in lib/job-collection.ts — never compare collected vs sale cents yourself.
 */
export async function getJobPaymentSummary(
  supabase: SupabaseClient,
  jobId: string
): Promise<JobPaymentSummary | null> {
  const { data: job, error: jobError } = await supabase
    .from('production_jobs')
    .select(JOB_COLLECTION_COLUMNS)
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    console.error('Error fetching job:', jobError)
    return null
  }

  const [payments, invoiceTax] = await Promise.all([getPaymentsByJob(supabase, jobId), loadInvoiceTaxCentsByJob(supabase, [jobId])])
  return buildJobPaymentSummary({ ...(job as JobCollectionJobRow), invoice_tax_cents: invoiceTax.get(jobId) ?? 0 }, payments)
}

type JobCollectionJobRow = {
  sale_amount: number | null
  allow_close_with_balance?: boolean | null
  close_balance_by?: string | null
  /** lib/job-invoice-tax.ts — sales tax billed on the job's invoices, owed on top of sale_amount. */
  invoice_tax_cents?: number | null
}

/** Pure: summary from an already-loaded job row + its payments. */
export function buildJobPaymentSummary(
  job: JobCollectionJobRow,
  payments: JobPayment[]
): JobPaymentSummary {
  const collection = evaluateJobCollection({
    saleAmount: job.sale_amount,
    invoiceTaxCents: job.invoice_tax_cents,
    payments,
    allowCloseWithBalance: job.allow_close_with_balance,
    closeBalanceBy: job.close_balance_by,
  })
  return {
    payments,
    collected_cents: collection.collectedCents,
    collected_dollars: collection.collectedCents / 100,
    // What must be collected: sale amount + invoice sales tax (equal to the sale amount when there is none).
    sale_amount_cents: collection.requiredCents,
    invoice_tax_cents: Math.max(0, Math.round(Number(job.invoice_tax_cents) || 0)),
    sale_amount_dollars: collection.requiredCents / 100,
    remaining_cents: collection.remainingCents,
    remaining_dollars: collection.remainingCents / 100,
    payment_count: payments.length,
    paid_in_full: collection.paidInFull,
    paid_by_payments: collection.paidByPayments,
    forced_paid_in_full: collection.forcedPaidInFull,
    legacy_close_with_balance: collection.legacyCloseWithBalance,
  }
}

/**
 * Add a payment to a job (append-only, no updates)
 * For refunds, use negative amount_cents
 */
export async function addJobPayment(
  supabase: SupabaseClient,
  payment: JobPaymentInsert
): Promise<JobPayment | null> {
  const { data, error } = await supabase
    .from('job_payments')
    .insert(payment)
    .select()
    .single()

  if (error) {
    console.error('Error adding payment:', error)
    return null
  }

  return data as JobPayment
}

/**
 * Format cents as currency string
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

/** YYYY-MM-DD date strings for invoice PDF and print views (noon local parse). */
export function formatInvoiceDisplayDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
