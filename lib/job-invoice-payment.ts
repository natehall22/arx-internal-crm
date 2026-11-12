/**
 * "Mark paid" on a JOB invoice in one step: the job payment (recordJobPayment, the one writer) and its application to this
 * invoice (applyPaymentToInvoice, the locked SQL apply) together, like a service invoice. Not a third writer — it only calls
 * the two that exist. Never more than the invoice balance; the payment's type follows the invoice (deposit / final).
 * If the apply fails after the payment was saved, the money stays recorded and shows as available on the invoice.
 */
import { paymentTypeForInvoice } from '@/lib/online-payments/record'
import type { SupabaseClient } from '@supabase/supabase-js'

import { applyPaymentToInvoice, computeInvoiceBalance, CUSTOMER_PAYMENT_METHODS, type CustomerPaymentMethod } from '@/lib/invoices'
import { recordJobPayment } from '@/lib/job-payment-record'

export type JobInvoicePaymentInput = {
  amountCents: number
  paidAt: string
  method: CustomerPaymentMethod
  note?: string | null
  createdBy: string | null
  idempotencyKey?: string | null
}

export type JobInvoicePaymentResult =
  | { ok: true; paymentId: string; balanceCents: number }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string }

export async function recordJobInvoicePayment(
  admin: SupabaseClient,
  orgId: string,
  invoice: { id: string; job_id: string; status: string },
  p: JobInvoicePaymentInput
): Promise<JobInvoicePaymentResult> {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return { ok: false, status: 400, error: 'Enter an amount above zero' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) || Number.isNaN(Date.parse(`${p.paidAt}T12:00:00Z`))) return { ok: false, status: 400, error: 'Pick the day it was paid' }
  if (!(CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(p.method)) return { ok: false, status: 400, error: 'Pick how it was paid' }
  if (invoice.status === 'draft') return { ok: false, status: 409, error: 'Email the invoice (or mark it sent) before recording a payment' }
  if (invoice.status === 'void') return { ok: false, status: 409, error: 'This invoice is void' }

  const before = await computeInvoiceBalance(admin, invoice.id)
  if (before.balance_cents <= 0) return { ok: false, status: 409, error: 'This invoice is already paid' }
  if (p.amountCents > before.balance_cents) return { ok: false, status: 400, error: 'That is more than the invoice balance' }

  // org-scope-ok: the invoice was verified in this company by findOrgInvoice in the caller (app/api/invoices/[invoiceId]); this reads its own row
  const { data: kindRow } = await admin.from('job_invoices').select('invoice_kind').eq('id', invoice.id).maybeSingle()
  const paymentType = paymentTypeForInvoice((kindRow as { invoice_kind?: string } | null)?.invoice_kind)

  const rec = await recordJobPayment(admin, {
    orgId,
    jobId: invoice.job_id,
    paidAt: p.paidAt,
    amountCents: p.amountCents,
    paymentType,
    method: p.method,
    payer: 'homeowner',
    note: p.note?.trim().slice(0, 500) || null,
    createdBy: p.createdBy,
    idempotencyKey: p.idempotencyKey ?? null,
  })
  if (!rec.ok) return { ok: false, status: rec.status, error: rec.error }
  try {
    await applyPaymentToInvoice(admin, orgId, invoice.id, rec.payment.id, p.amountCents, p.createdBy)
  } catch (e) {
    console.error('job invoice payment: saved but not applied', invoice.id, (e as Error).message)
    return { ok: false, status: 500, error: 'The payment was saved on the job but could not be applied to this invoice. Apply it from the invoice.' }
  }
  const after = await computeInvoiceBalance(admin, invoice.id)
  return { ok: true, paymentId: rec.payment.id, balanceCents: after.balance_cents }
}
