/**
 * THE writer of a job payment — server only (it sends email and queues QuickBooks). Kept out of lib/job-payments.ts,
 * which client components import for formatCurrency and the payment summary.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { enqueuePaymentRecorded } from '@/lib/integrations'
import { notifyAdminOpsOfJobPayment } from '@/lib/job-payment-email'
import { getJobPaymentSummary } from '@/lib/job-payments'
import type { JobPayment, PaymentMethod, PaymentPayer, PaymentType } from '@/lib/types/job-payments'

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
