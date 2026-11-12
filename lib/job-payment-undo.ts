/**
 * "Undo payment" — the ONLY way a recorded job payment is taken back (Nathan: money is never deleted). A payment is
 * undone by a NEGATIVE payment through the one writer (`recordJobPayment`): the original row stays, the reversal row
 * carries who / when / why (created_by, created_at, the reason in its note), the QuickBooks outbox gets `payment.voided` (QuickBooks voids the original Payment),
 * "paid in full" (lib/job-collection.ts), payroll eligibility and the time & materials commission change lines all read
 * the payments and follow on their own. A payment already applied to a job invoice is taken back off that invoice too
 * (`applyRefundToInvoice`, the same locked SQL online refunds use), so the invoice re-opens instead of staying "paid".
 *
 * Refused: a payment taken online (refund it in Stripe — the refund then arrives by webhook), a reversal row, and — for
 * everyone but an owner — a job whose money is already in an approved pay week or collected. Idempotent per payment
 * (key `undo:<payment id>`): a double tap or a retry never writes a second reversal. A job that drops below paid in full goes back
 * from collected to complete; if its commission was already paid, the "Payment reversed — review" Today line says so
 * (lib/online-payments/summary.ts loadPaymentReversalsQueue, the same list a lost dispute raises).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { applyRefundToInvoice } from '@/lib/invoices'
import { formatCurrency } from '@/lib/job-payments'
import { recordJobPayment } from '@/lib/job-payment-record'
import { jobsPaidInFull } from '@/lib/job-collection-db'
import { jobAlreadyPaidOut } from '@/lib/online-payments/record'
import { projectStatusForJobStatus } from '@/lib/job-status'
import { ymdInZone } from '@/lib/payroll-week-schedule'
import { undoKey, undoRefusal, UNDO_REASON_MAX } from '@/lib/job-payment-undo-rules'
import type { JobPayment } from '@/lib/types/job-payments'

export type UndoJobPaymentInput = {
  orgId: string
  jobId: string
  paymentId: string
  reason: string
  actor: { id: string; isOwner: boolean }
}

export type UndoJobPaymentResult =
  | { ok: true; reversal: JobPayment; alreadyUndone: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string }

export async function undoJobPayment(admin: SupabaseClient, input: UndoJobPaymentInput): Promise<UndoJobPaymentResult> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, status: 400, error: 'Say why you are undoing this payment.' }
  if (reason.length > UNDO_REASON_MAX) return { ok: false, status: 400, error: `Keep the reason under ${UNDO_REASON_MAX} letters.` }

  const { data: job } = await admin.from('production_jobs').select('id').eq('id', input.jobId).eq('org_id', input.orgId).maybeSingle()
  if (!job) return { ok: false, status: 404, error: 'Job not found' }
  // org-scope-ok: the job was just loaded in input.orgId; the payment must be this job's
  const { data: row } = await admin.from('job_payments').select('*').eq('id', input.paymentId).eq('job_id', input.jobId).maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'Payment not found' }
  const payment = row as JobPayment

  const key = undoKey(payment.id)
  // org-scope-ok: same job as above
  const { data: prior } = await admin.from('job_payments').select('*').eq('job_id', input.jobId).eq('idempotency_key', key).maybeSingle()
  if (!prior) {
    const refusal = undoRefusal(payment)
    if (refusal) return { ok: false, status: 409, error: refusal }
    const paidOut = await jobAlreadyPaidOut(admin, input.orgId, input.jobId)
    if (paidOut && !input.actor.isOwner) return { ok: false, status: 403, error: `This job is ${paidOut}. Only an owner can undo a payment now.` }
  }

  const paidAt = ymdInZone(new Date(), await loadOrgTimeZone(admin, input.orgId))
  const result = await recordJobPayment(admin, {
    orgId: input.orgId,
    jobId: input.jobId,
    paidAt,
    amountCents: -payment.amount_cents,
    paymentType: payment.payment_type,
    method: payment.method,
    payer: payment.payer,
    note: `Undo of ${formatCurrency(payment.amount_cents)} paid ${payment.paid_at}: ${reason}`,
    createdBy: input.actor.id,
    idempotencyKey: key,
    eventType: 'payment.voided',
  })
  if (!result.ok) return { ok: false, status: result.status, error: result.error }

  // Take it back off every invoice it was applied to (re-run safely: a repeat applies nothing new).
  const { data: apps } = await admin.from('invoice_payments').select('invoice_id, applied_cents').eq('job_payment_id', payment.id)
  const byInvoice = new Map<string, number>()
  for (const a of (apps ?? []) as Array<{ invoice_id: string; applied_cents: number }>) {
    byInvoice.set(a.invoice_id, (byInvoice.get(a.invoice_id) ?? 0) + Number(a.applied_cents))
  }
  for (const [invoiceId, applied] of Array.from(byInvoice)) {
    if (applied > 0) await applyRefundToInvoice(admin, input.orgId, invoiceId, result.payment.id, applied)
  }

  // The job is no longer paid in full: it goes back from collected to complete (so it shows as owing again). Runs on a repeat
  // too (a crash after the reversal was saved must still finish this); a job already back, or still paid in full, is left alone.
  {
    const { data: after } = await admin.from('production_jobs').select('status, project_id').eq('id', input.jobId).eq('org_id', input.orgId).maybeSingle()
    const j = after as { status?: string; project_id?: string | null } | null
    if (j?.status === 'collected' && !(await jobsPaidInFull(admin, input.orgId, [input.jobId])).has(input.jobId)) {
      await admin.from('production_jobs').update({ status: 'complete' }).eq('id', input.jobId).eq('org_id', input.orgId)
      if (j.project_id) await admin.from('projects').update({ status: projectStatusForJobStatus('complete') }).eq('id', j.project_id).eq('org_id', input.orgId)
    }
  }
  return { ok: true, reversal: result.payment, alreadyUndone: result.duplicate }
}
