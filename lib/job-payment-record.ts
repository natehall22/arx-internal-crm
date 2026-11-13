/**
 * THE writer of a job payment — server only (it sends email and queues QuickBooks). Kept out of lib/job-payments.ts,
 * which client components import for formatCurrency and the payment summary.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { enqueuePaymentRecorded } from '@/lib/integrations'
import { syncTimeAndMaterialsCommissionBase } from '@/lib/job-commission-base'
import { notifyAdminOpsOfJobPayment } from '@/lib/job-payment-email'
import { getJobPaymentSummary } from '@/lib/job-payments'
import { isMissingFunction } from '@/lib/org-settings'
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
  /** QuickBooks outbox event: money in (default), or money back out by a refund / a lost dispute. */
  eventType?: 'payment.recorded' | 'payment.refunded' | 'payment.disputed' | 'payment.voided'
}

export type RecordJobPaymentResult =
  | {
      ok: true
      payment: JobPayment
      duplicate: boolean
      /**
       * True when the job is billed by the hour: its commission base follows the money in, so this payment (or a refund /
       * lost dispute) already went through the commission change lines (lib/payroll-commission-change.ts). False on a
       * fixed-price job (base = the signed contract, money in never moves it) and on a repeat.
       */
      commissionFollowsPayments: boolean
    }
  | { ok: false; status: 404 | 500; error: string }

/**
 * THE writer of a job payment (append-only): the office's "Add payment" (POST /api/ops/jobs/[id]/payments) and the online
 * payment webhook (lib/online-payments/record.ts) both come here. ONE SQL transaction (`record_job_payment`, migration
 * 202611120020): the `job_payments` row AND its QuickBooks outbox event (`payment.recorded`, or `payment.refunded` /
 * `payment.disputed` for money going back out) — a repeat with the same key writes no payment and re-queues the outbox
 * row only if it is missing. Then the time & materials commission sync and the admin/ops payment email (not on a repeat). "Paid in full" is never stored: it is
 * read from the payments by lib/job-collection.ts. Before the migration: the old insert-then-enqueue path.
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
  const j = job as { customer_id: string | null; job_number: string | null; address_text: string | null }

  const { data, error } = await admin.rpc('record_job_payment', {
    p_org: p.orgId,
    p_job: p.jobId,
    p_paid_at: p.paidAt,
    p_amount_cents: p.amountCents,
    p_payment_type: p.paymentType,
    p_method: p.method,
    p_payer: p.payer,
    p_note: p.note || null,
    p_created_by: p.createdBy,
    p_idempotency_key: key,
    p_event_type: p.eventType ?? 'payment.recorded',
  })
  let payment: JobPayment
  let duplicate = false
  if (error && isMissingFunction(error)) {
    const legacy = await legacyInsertThenEnqueue(admin, p, key, j)
    if (!legacy.ok) return legacy
    payment = legacy.payment
    duplicate = legacy.duplicate
  } else if (error) {
    if (error.code === 'P0002') return { ok: false, status: 404, error: 'Job not found' }
    console.error('recordJobPayment: record_job_payment failed', error)
    return { ok: false, status: 500, error: 'Failed to add payment' }
  } else {
    const r = (data ?? {}) as { payment?: JobPayment; duplicate?: boolean }
    if (!r.payment) return { ok: false, status: 500, error: 'Failed to add payment' }
    payment = r.payment
    duplicate = !!r.duplicate
  }
  if (duplicate) return { ok: true, payment, duplicate: true, commissionFollowsPayments: false }

  // Billed by the hour: money in (or back out) moves the paid-for commission base → commission change lines on the next open
  // week when the job was already paid on an approved week. No-op (null) for fixed-price jobs. Never throws.
  const tm = await syncTimeAndMaterialsCommissionBase(admin, p.orgId, p.jobId)

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
        paidInFull: summary.paid_in_full === true,
      })
    })
    .catch((err) => console.error('notifyAdminOpsOfJobPayment failed:', err))

  return { ok: true, payment, duplicate: false, commissionFollowsPayments: tm?.status === 'time_materials' }
}

/** Until migration 202611120020 is applied: the original two steps (insert, then queue). */
async function legacyInsertThenEnqueue(
  admin: SupabaseClient,
  p: RecordJobPaymentInput,
  key: string | null,
  j: { customer_id: string | null }
): Promise<{ ok: true; payment: JobPayment; duplicate: boolean } | { ok: false; status: 500; error: string }> {
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
      // org-scope-ok: jobId was loaded in p.orgId by the caller; (job_id, idempotency_key) is unique (migration 122)
      const { data: first } = await admin.from('job_payments').select('*').eq('job_id', p.jobId).eq('idempotency_key', key).maybeSingle()
      if (first) return { ok: true, payment: first as JobPayment, duplicate: true }
    }
    console.error('recordJobPayment: insert failed', error)
    return { ok: false, status: 500, error: 'Failed to add payment' }
  }
  await enqueuePaymentRecorded(admin, p.orgId, (payment as JobPayment).id, {
    job_id: p.jobId,
    customer_id: j.customer_id ?? undefined,
    amount_cents: p.amountCents,
    paid_at: p.paidAt,
    payment_type: p.paymentType,
    method: p.method,
    payer: p.payer,
  }).catch((err) => console.error('Failed to enqueue payment event:', err))
  return { ok: true, payment: payment as JobPayment, duplicate: false }
}
