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
import { StripeApiError, stripeKeyIsLive, stripeRequest } from '@/lib/stripe/api'
import type { JobInvoice } from '@/lib/types/invoices'
import { loadOnlinePayments, type OnlinePayments } from '@/lib/online-payments/accounts'
import { cardExpired, loadCardOnFile } from '@/lib/online-payments/cards'
import { payableCents } from '@/lib/online-payments/checkout'
import { createPaymentLink } from '@/lib/online-payments/links'
import { failRow, markProcessing, recordSucceededIntent, type RecordOutcome } from '@/lib/online-payments/record'
import { applicationFeeCents, MAX_RETRIES } from '@/lib/online-payments/settings'

export type AutopayOutcome = { charged: false; reason: string } | { charged: true; outcome: RecordOutcome | 'failed' }

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
  const { data: tries } = await orgDb(admin, orgId).from('online_payments').select('attempt, status, created_at').eq('invoice_id', invoiceId).eq('kind', 'autopay')
  const past = (tries ?? []) as Array<{ attempt: number; status: string; created_at: string }>
  // In flight: a bank payment clearing, or a charge started in the last 15 minutes (an older 'open' one died mid-way).
  const inFlight = (t: { status: string; created_at: string }) => t.status === 'processing' || (t.status === 'open' && now.getTime() - Date.parse(t.created_at) < 15 * 60_000)
  if (past.some(inFlight)) return { charged: false, reason: 'a payment is already on its way' }
  const attempt = attemptIn ?? past.reduce((m, t) => Math.max(m, t.attempt), 0) + 1
  if (attempt > MAX_RETRIES + 1) return { charged: false, reason: 'retries used up' }
  const invoice = await findOrgInvoice(admin, invoiceId, orgId)
  if (!invoice || invoice.job_id || !invoice.customer_id) return { charged: false, reason: 'not a service invoice' }
  if (invoice.status === 'void' || invoice.status === 'paid') return { charged: false, reason: invoice.status }
  const card = await loadCardOnFile(admin, orgId, invoice.customer_id)
  if (!card || !card.autopay) return { charged: false, reason: 'no card on file' }
  if (card.account_id !== op.account.account_id) return { charged: false, reason: 'card saved on an older Stripe account' }
  if (cardExpired(card, now)) return { charged: false, reason: 'card expired' }
  const { payableCents: amount } = await payableCents(admin, orgId, invoice.id)
  if (amount <= 0) return { charged: false, reason: 'nothing owed' }

  const fee = applicationFeeCents(amount)
  const { data: row, error } = await orgDb(admin, orgId)
    .from('online_payments')
    .insert({
      account_id: op.account.account_id,
      livemode: stripeKeyIsLive(),
      kind: 'autopay',
      invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      amount_cents: amount,
      application_fee_cents: fee,
      status: 'open',
      attempt,
    })
    .select('id, kind, invoice_id, amount_cents, attempt')
    .single()
  if (error || !row) return { charged: false, reason: error?.code === '23505' ? 'already tried' : `could not start: ${error?.message}` }
  const r = row as { id: string; kind: 'autopay'; invoice_id: string; amount_cents: number; attempt: number }
  const metadata = { crm_org_id: orgId, invoice_id: invoice.id, kind: 'autopay', attempt: String(attempt), online_payment_id: r.id }
  try {
    const pi = await stripeRequest(
      'POST',
      '/v1/payment_intents',
      {
        amount,
        currency: 'usd',
        customer: card.stripe_customer_id,
        payment_method: card.payment_method_id,
        payment_method_types: ['card'],
        off_session: true,
        confirm: true,
        description: 'Automatic payment',
        metadata,
        expand: ['latest_charge'],
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { account: op.account.account_id, idempotencyKey: `autopay:${invoice.id}:${attempt}` }
    )
    await orgDb(admin, orgId).from('online_payments').update({ payment_intent_id: String(pi.id) }).eq('id', r.id)
    if (pi.status === 'succeeded') return { charged: true, outcome: await recordSucceededIntent(admin, op.account, pi, { now }) }
    if (pi.status === 'processing') return { charged: true, outcome: await markProcessing(admin, op.account, pi) }
    // requires_action (3-D Secure) can't be done off-session: treat as a failure so the customer gets a pay link.
    await failRow(admin, orgId, r, { code: String(pi.status), message: 'The bank asked the card holder to confirm this payment' }, now)
    return { charged: true, outcome: 'failed' }
  } catch (e) {
    if (!(e instanceof StripeApiError) || (e.type !== 'card_error' && e.status !== 402)) {
      // Not a decline (network, Stripe down): free the attempt so the next send / retry can try again.
      await orgDb(admin, orgId).from('online_payments').update({ status: 'failed', failure_message: 'Could not reach Stripe', next_retry_at: null }).eq('id', r.id)
      throw e
    }
    if (e.paymentIntent?.id) await orgDb(admin, orgId).from('online_payments').update({ payment_intent_id: String(e.paymentIntent.id) }).eq('id', r.id)
    await failRow(admin, orgId, r, { code: e.declineCode ?? e.code, message: e.message }, now)
    return { charged: true, outcome: 'failed' }
  }
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
  for (const r of (data ?? []) as Array<{ id: string; invoice_id: string; attempt: number }>) {
    const { data: claimed } = await orgDb(admin, orgId).from('online_payments').update({ next_retry_at: null }).eq('id', r.id).not('next_retry_at', 'is', null).select('id')
    if (((claimed ?? []) as unknown[]).length !== 1) continue
    await chargeInvoiceAutopay(admin, op, orgId, r.invoice_id, r.attempt + 1, now).catch((e) => console.error('runAutopayRetries: charge failed to run', r.invoice_id, e))
    tried++
  }
  return { tried }
}
