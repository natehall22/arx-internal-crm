/**
 * Automatic payment for invoices without a job (service plans): when the office sends the invoice and the customer has a
 * card on file with autopay on, the card is charged first (off-session PaymentIntent on the company's account) and the
 * email then says Paid; if it fails, the invoice stays open, the email carries a pay link, the customer and office are
 * told, and the card is tried again on the company's retry days (morning cron, `runAutopayRetries`).
 * One charge per invoice per attempt (unique index + Stripe idempotency key): a double "Send" can never charge twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendCustomerInvoice, type SendInvoiceResult } from '@/lib/invoice-email'
import { findOrgInvoice } from '@/lib/invoices'
import { orgDb } from '@/lib/supabase/org-db'
import { StripeApiError, stripeKeyIsLive, stripeRequest, type StripeObject } from '@/lib/stripe/api'
import type { JobInvoice } from '@/lib/types/invoices'
import { loadOnlinePayments, type OnlinePayments } from '@/lib/online-payments/accounts'
import { cardExpired, loadCardOnFile } from '@/lib/online-payments/cards'
import { payableCents } from '@/lib/online-payments/checkout'
import { createPaymentLink } from '@/lib/online-payments/links'
import { failRow, markProcessing, recordSucceededIntent, type RecordOutcome } from '@/lib/online-payments/record'
import { applicationFeeCents, MAX_RETRIES } from '@/lib/online-payments/settings'

export type AutopayOutcome = { charged: false; reason: string } | { charged: true; outcome: RecordOutcome | 'failed' }

type AttemptRow = { id: string; kind: 'autopay'; invoice_id: string; amount_cents: number; application_fee_cents: number; attempt: number; payment_intent_id: string | null; status: string; created_at: string }
const ATTEMPT_COLS = 'id, kind, invoice_id, amount_cents, application_fee_cents, attempt, payment_intent_id, status, created_at'

export async function chargeInvoiceAutopay(
  admin: SupabaseClient,
  op: OnlinePayments,
  orgId: string,
  invoiceId: string,
  /** Omitted = the next attempt for this invoice (a send); the retry cron passes its own. */
  attemptIn: number | null = null,
  now: Date = new Date()
): Promise<AutopayOutcome> {
  if (!op.ready || !op.account || !op.settings.autopay) return { charged: false, reason: 'off' }
  const { data: tries } = await orgDb(admin, orgId).from('online_payments').select(ATTEMPT_COLS).eq('invoice_id', invoiceId).eq('kind', 'autopay')
  const past = (tries ?? []) as AttemptRow[]
  if (past.some((t) => t.status === 'processing')) return { charged: false, reason: 'a payment is already on its way' }
  const invoice = await findOrgInvoice(admin, invoiceId, orgId)
  if (!invoice || invoice.job_id || !invoice.customer_id) return { charged: false, reason: 'not a service invoice' }
  const card = await loadCardOnFile(admin, orgId, invoice.customer_id)
  // An attempt that never got its answer (network error, timeout, crash) is finished with the SAME attempt number,
  // amount and Stripe idempotency key — never a new charge beside it.
  const open = past.find((t) => t.status === 'open')
  if (open) return resumeAttempt(admin, op, orgId, open, card, now)

  const attempt = attemptIn ?? past.reduce((m, t) => Math.max(m, t.attempt), 0) + 1
  if (attempt > MAX_RETRIES + 1) return { charged: false, reason: 'retries used up' }
  if (invoice.status === 'void' || invoice.status === 'paid') return { charged: false, reason: invoice.status }
  if (!card || !card.autopay) return { charged: false, reason: 'no card on file' }
  if (card.account_id !== op.account.account_id) return { charged: false, reason: 'card saved on an older Stripe account' }
  if (cardExpired(card, now)) return { charged: false, reason: 'card expired' }
  const { payableCents: amount } = await payableCents(admin, orgId, invoice.id)
  if (amount <= 0) return { charged: false, reason: 'nothing owed' }

  const { data: row, error } = await orgDb(admin, orgId)
    .from('online_payments')
    .insert({
      account_id: op.account.account_id,
      livemode: stripeKeyIsLive(),
      kind: 'autopay',
      invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      amount_cents: amount,
      application_fee_cents: applicationFeeCents(amount),
      currency: op.settings.currency,
      status: 'open',
      attempt,
    })
    .select(ATTEMPT_COLS)
    .single()
  if (error || !row) return { charged: false, reason: error?.code === '23505' ? 'already tried' : `could not start: ${error?.message}` }
  return chargeAttempt(admin, op, orgId, row as AttemptRow, card, now)
}

/** Stripe may already hold this attempt's PaymentIntent even if we never saw the answer: look before charging. */
async function findAttemptIntent(op: OnlinePayments, row: AttemptRow): Promise<StripeObject | null> {
  const account = op.account!.account_id
  if (row.payment_intent_id) return stripeRequest('GET', `/v1/payment_intents/${encodeURIComponent(row.payment_intent_id)}`, { expand: ['latest_charge'] }, { account })
  const found = await stripeRequest('GET', '/v1/payment_intents/search', { query: `metadata['online_payment_id']:'${row.id}'`, limit: 1 }, { account })
  const hit = ((found.data ?? []) as StripeObject[])[0]
  return hit ? stripeRequest('GET', `/v1/payment_intents/${encodeURIComponent(String(hit.id))}`, { expand: ['latest_charge'] }, { account }) : null
}

async function resumeAttempt(admin: SupabaseClient, op: OnlinePayments, orgId: string, row: AttemptRow, card: Awaited<ReturnType<typeof loadCardOnFile>>, now: Date): Promise<AutopayOutcome> {
  const existing = await findAttemptIntent(op, row)
  if (existing) return settle(admin, op, orgId, row, existing, now)
  // Not at Stripe. Only charge if it's still owed and the card is the one this attempt was for.
  const { payableCents: owed } = await payableCents(admin, orgId, row.invoice_id)
  if (owed < row.amount_cents || !card || !card.autopay || card.account_id !== op.account!.account_id) {
    await orgDb(admin, orgId).from('online_payments').update({ status: 'expired', updated_at: now.toISOString() }).eq('id', row.id).eq('status', 'open')
    return { charged: false, reason: 'earlier attempt closed: no longer owed or no card' }
  }
  return chargeAttempt(admin, op, orgId, row, card, now)
}

/** POST the PaymentIntent for this attempt — always the attempt's own amount and key, so a repeat is the same charge. */
async function chargeAttempt(admin: SupabaseClient, op: OnlinePayments, orgId: string, row: AttemptRow, card: NonNullable<Awaited<ReturnType<typeof loadCardOnFile>>> | null, now: Date): Promise<AutopayOutcome> {
  if (!card) return { charged: false, reason: 'no card on file' }
  const metadata = { crm_org_id: orgId, invoice_id: row.invoice_id, kind: 'autopay', attempt: String(row.attempt), online_payment_id: row.id }
  let pi: StripeObject
  try {
    pi = await stripeRequest(
      'POST',
      '/v1/payment_intents',
      {
        amount: row.amount_cents,
        currency: op.settings.currency,
        customer: card.stripe_customer_id,
        payment_method: card.payment_method_id,
        payment_method_types: ['card'],
        off_session: true,
        confirm: true,
        description: 'Automatic payment',
        metadata,
        expand: ['latest_charge'],
        ...(row.application_fee_cents > 0 ? { application_fee_amount: row.application_fee_cents } : {}),
      },
      { account: op.account!.account_id, idempotencyKey: `autopay:${row.invoice_id}:${row.attempt}` }
    )
  } catch (e) {
    if (e instanceof StripeApiError && (e.type === 'card_error' || e.status === 402)) {
      if (e.paymentIntent?.id) await orgDb(admin, orgId).from('online_payments').update({ payment_intent_id: String(e.paymentIntent.id) }).eq('id', row.id)
      await failRow(admin, orgId, row, { code: e.declineCode ?? e.code, message: e.message }, now)
      return { charged: true, outcome: 'failed' }
    }
    // No answer (network, timeout, Stripe 5xx): Stripe MAY have charged. The attempt stays open and is finished later
    // (next send / morning cron) by asking Stripe first, then re-sending the SAME key — never a second charge.
    await orgDb(admin, orgId).from('online_payments').update({ failure_message: `No answer from Stripe yet: ${(e as Error).message}`.slice(0, 300), updated_at: now.toISOString() }).eq('id', row.id)
    throw e
  }
  return settle(admin, op, orgId, row, pi, now)
}

async function settle(admin: SupabaseClient, op: OnlinePayments, orgId: string, row: AttemptRow, pi: StripeObject, now: Date): Promise<AutopayOutcome> {
  if (!row.payment_intent_id) await orgDb(admin, orgId).from('online_payments').update({ payment_intent_id: String(pi.id) }).eq('id', row.id)
  if (pi.status === 'succeeded') return { charged: true, outcome: await recordSucceededIntent(admin, op.account!, pi, { now }) }
  if (pi.status === 'processing') return { charged: true, outcome: await markProcessing(admin, op.account!, pi) }
  // Declined, canceled, or the bank wants the card holder to confirm (can't be done off-session): failed, pay link sent.
  const err = (pi.last_payment_error ?? {}) as StripeObject
  const message = typeof err.message === 'string' ? err.message : pi.status === 'requires_action' ? 'The bank asked the card holder to confirm this payment' : 'The payment did not go through'
  await failRow(admin, orgId, row, { code: typeof err.decline_code === 'string' ? err.decline_code : String(pi.status), message }, now)
  return { charged: true, outcome: 'failed' }
}

/**
 * "Send" for an invoice without a job, with online payments: autopay first (when it applies), then the email — with a
 * pay link while anything is still owed. Without online payments this is exactly `sendCustomerInvoice`.
 */
export async function sendCustomerInvoiceOnline(
  admin: SupabaseClient,
  orgId: string,
  invoice: JobInvoice,
  to: string | null,
  userId: string | null
): Promise<SendInvoiceResult & { autopay?: AutopayOutcome }> {
  const op = await loadOnlinePayments(admin, orgId)
  if (!op.ready || invoice.job_id) return sendCustomerInvoice(admin, orgId, invoice, to)
  let current = invoice
  let autopay: AutopayOutcome | undefined
  if (op.settings.autopay && invoice.status !== 'void') {
    autopay = await chargeInvoiceAutopay(admin, op, orgId, invoice.id).catch((e) => {
      console.error('sendCustomerInvoiceOnline: autopay failed to run', e)
      return { charged: false as const, reason: 'error' }
    })
    if (autopay.charged) {
      // The payment may have issued a draft and changed the status: send what is true now.
      const { data } = await orgDb(admin, orgId).from('job_invoices').select('*').eq('id', invoice.id).maybeSingle()
      if (data) current = data as JobInvoice
    }
  }
  const owed = current.status !== 'paid' && current.status !== 'void'
  const payUrl = owed ? (await createPaymentLink(admin, orgId, { kind: 'invoice', invoiceId: invoice.id }, userId)).url : null
  const sent = await sendCustomerInvoice(admin, orgId, current, to, { payUrl })
  return { ...sent, ...(autopay ? { autopay } : {}) }
}

/** Morning cron: cards whose retry day has come are tried again (each failed attempt is claimed once). */
export async function runAutopayRetries(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<{ tried: number }> {
  const op = await loadOnlinePayments(admin, orgId)
  if (!op.ready || !op.settings.autopay) return { tried: 0 }
  const { data } = await orgDb(admin, orgId)
    .from('online_payments')
    .select('id, invoice_id, attempt')
    .eq('kind', 'autopay')
    .eq('status', 'failed')
    .lte('next_retry_at', now.toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(50)
  let tried = 0
  // Attempts that never got Stripe's answer (open > 10 minutes): finish them (ask Stripe, then the same key).
  const { data: stale } = await orgDb(admin, orgId)
    .from('online_payments')
    .select('invoice_id')
    .eq('kind', 'autopay')
    .eq('status', 'open')
    .lt('created_at', new Date(now.getTime() - 10 * 60_000).toISOString())
    .limit(50)
  for (const r of (stale ?? []) as Array<{ invoice_id: string }>) {
    await chargeInvoiceAutopay(admin, op, orgId, r.invoice_id, null, now).catch((e) => console.error('runAutopayRetries: resume failed', r.invoice_id, e))
    tried++
  }
  for (const r of (data ?? []) as Array<{ id: string; invoice_id: string; attempt: number }>) {
    const { data: claimed } = await orgDb(admin, orgId).from('online_payments').update({ next_retry_at: null }).eq('id', r.id).not('next_retry_at', 'is', null).select('id')
    if (((claimed ?? []) as unknown[]).length !== 1) continue
    await chargeInvoiceAutopay(admin, op, orgId, r.invoice_id, r.attempt + 1, now).catch((e) => console.error('runAutopayRetries: charge failed to run', r.invoice_id, e))
    tried++
  }
  return { tried }
}
