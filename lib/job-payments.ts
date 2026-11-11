import { SupabaseClient } from '@supabase/supabase-js'
import type { JobPayment, JobPaymentSummary, PaymentMethod, PaymentPayer, PaymentType } from './types/job-payments'
import { enqueuePaymentRecorded } from './integrations'
import { notifyAdminOpsOfJobPayment } from './job-payment-email'
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

export type RecordJobPaymentInput = {
  orgId: string
  jobId: string
  paidAt: string
  /** Refunds are negative (append-only: a payment is never edited or deleted). */
  amountCents: number
  paymentType: PaymentType
  method: PaymentMethod
  payer: PaymentPayer
  note?: string | null
  createdBy: string | null
  /** A processor's payment / refund id: a retry with the same key returns the first row instead of a second one. */
  idempotencyKey?: string | null
}

export type RecordJobPaymentResult =
  | { ok: true; payment: JobPayment; duplicate: boolean }
  | { ok: false; status: 404 | 500; error: string }

/**
 * THE writer of a job payment (append-only): the office's "Add payment" (POST /api/ops/jobs/[id]/payments) and the online
 * payment webhook (lib/online-payments/record.ts) both come here. One row in `job_payments`, then the QuickBooks outbox
 * `payment.recorded` (lib/integrations.ts) and the admin/ops payment email. "Paid in full" is never stored: it is
 * read from the payments by lib/job-collection.ts. A repeated idempotency key writes nothing and sends nothing.
 */
export async function recordJobPayment(admin: SupabaseClient, p: RecordJobPaymentInput): Promise<RecordJobPaymentResult> {
  const { data: job, error: jobError } = await admin
    .from('production_jobs')
    .select('id, customer_id, job_number, address_text')
    .eq('id', p.jobId)
    .eq('org_id', p.orgId)
    .maybeSingle()
  if (jobError || !job) return { ok: false, status: 404, error: 'Job not found' }
  const key = p.idempotencyKey?.trim() || null

  const { data: payment, error } = await admin
    .from('job_payments')
    .insert({
      job_id: p.jobId,
      paid_at: p.paidAt,
      amount_cents: p.amountCents,
      payment_type: p.paymentType,
      method: p.method,
      payer: p.payer,
      note: p.note || null,
      created_by: p.createdBy,
      ...(key ? { idempotency_key: key } : {}),
    })
    .select()
    .single()

  if (error || !payment) {
    if (key && error?.code === '23505') {
      // org-scope-ok: jobId was loaded in p.orgId just above; (job_id, idempotency_key) is unique (migration 122)
      const { data: first } = await admin.from('job_payments').select('*').eq('job_id', p.jobId).eq('idempotency_key', key).maybeSingle()
      if (first) return { ok: true, payment: first as JobPayment, duplicate: true }
    }
    console.error('recordJobPayment: insert failed', error)
    return { ok: false, status: 500, error: 'Failed to add payment' }
  }

  const j = job as { customer_id: string | null; job_number: string | null; address_text: string | null }
  await enqueuePaymentRecorded(admin, p.orgId, (payment as JobPayment).id, {
    job_id: p.jobId,
    customer_id: j.customer_id ?? undefined,
    amount_cents: p.amountCents,
    paid_at: p.paidAt,
    payment_type: p.paymentType,
    method: p.method,
    payer: p.payer,
  }).catch((err) => console.error('Failed to enqueue payment event:', err))

  // Email admin + operations (non-blocking)
  getJobPaymentSummary(admin, p.jobId)
    .then((summary) => {
      if (!summary) return
      return notifyAdminOpsOfJobPayment(admin, {
        orgId: p.orgId,
        jobId: p.jobId,
        jobNumber: j.job_number || p.jobId,
        addressText: j.address_text || '',
        amountCents: p.amountCents,
        payer: String(p.payer),
        method: String(p.method),
        paidAt: String(p.paidAt),
        collectedCents: summary.collected_cents,
        remainingCents: summary.remaining_cents,
        saleAmountCents: summary.sale_amount_cents,
      })
    })
    .catch((err) => console.error('notifyAdminOpsOfJobPayment failed:', err))

  return { ok: true, payment: payment as JobPayment, duplicate: false }
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
