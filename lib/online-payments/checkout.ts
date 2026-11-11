/**
 * Stripe-hosted Checkout on the company's own account (direct charge, `Stripe-Account` header) — card data only ever
 * reaches Stripe (PCI SAQ-A). Two kinds:
 *  - pay an invoice (deposit, job or service invoice): the balance, or a part when the company allows it; card + bank
 *    (ACH, `us_bank_account`) unless the company turned bank off; optionally "save this card" (setup_future_usage) on an
 *    invoice without a job when autopay is on;
 *  - save a card (mode `setup` = a SetupIntent): autopay for service plans.
 * No surcharge is ever added. The optional platform fee (settings.platformFeeBps, default 0) is an application fee.
 * https://docs.stripe.com/connect/direct-charges · https://docs.stripe.com/checkout/fulfillment
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { computeInvoiceBalance, findOrgInvoice } from '@/lib/invoices'
import { orgDb } from '@/lib/supabase/org-db'
import { StripeApiError, stripeKeyIsLive, stripeRequest, type StripeObject } from '@/lib/stripe/api'
import type { OnlinePayments } from '@/lib/online-payments/accounts'
import { ensureStripeCustomer } from '@/lib/online-payments/cards'
import type { PaymentLinkRow } from '@/lib/online-payments/links'
import { applicationFeeCents, autopayConsentText, chargeAmountCents } from '@/lib/online-payments/settings'

export type CheckoutResult = { ok: true; url: string } | { ok: false; status: 400 | 404 | 409 | 503; error: string }

/** Session lifetime: Stripe's minimum is 30 minutes. */
const SESSION_MINUTES = 60

/** What is still payable online: balance minus bank payments already on their way (so a clearing ACH can't be paid twice). */
export async function payableCents(admin: SupabaseClient, orgId: string, invoiceId: string): Promise<{ balanceCents: number; processingCents: number; payableCents: number }> {
  const bal = await computeInvoiceBalance(admin, invoiceId)
  const { data } = await orgDb(admin, orgId).from('online_payments').select('amount_cents').eq('invoice_id', invoiceId).eq('status', 'processing')
  const processingCents = ((data ?? []) as Array<{ amount_cents: number }>).reduce((s, r) => s + r.amount_cents, 0)
  return { balanceCents: bal.balance_cents, processingCents, payableCents: Math.max(0, bal.balance_cents - processingCents) }
}

/** The customer an invoice belongs to (no-job: its own; job: the job's customer), or null. */
export async function invoiceCustomerId(admin: SupabaseClient, orgId: string, invoice: { job_id: string | null; customer_id?: string | null }): Promise<string | null> {
  if (!invoice.job_id) return invoice.customer_id ?? null
  const { data } = await orgDb(admin, orgId).from('production_jobs').select('customer_id').eq('id', invoice.job_id).maybeSingle()
  return ((data as { customer_id?: string | null } | null)?.customer_id as string | null) ?? null
}

async function createSession(params: Record<string, unknown>, accountId: string, idem: string, bank: boolean): Promise<StripeObject> {
  try {
    return await stripeRequest('POST', '/v1/checkout/sessions', { ...params, payment_method_types: bank ? ['card', 'us_bank_account'] : ['card'] }, { account: accountId, idempotencyKey: idem })
  } catch (e) {
    // The company has not turned ACH on in its Stripe account: still take cards rather than fail the customer.
    if (bank && e instanceof StripeApiError && e.status === 400 && /payment_method_types|us_bank_account/i.test(`${e.param} ${e.message}`)) {
      console.warn('createSession: bank payments not enabled on the connected account, card only', accountId)
      return stripeRequest('POST', '/v1/checkout/sessions', { ...params, payment_method_types: ['card'] }, { account: accountId, idempotencyKey: `${idem}:card` })
    }
    throw e
  }
}

export async function createInvoiceCheckout(
  admin: SupabaseClient,
  op: OnlinePayments,
  link: PaymentLinkRow,
  req: { amountCents?: number | null; saveCard?: boolean; companyName: string },
  urls: { successUrl: string; cancelUrl: string },
  now: Date = new Date()
): Promise<CheckoutResult> {
  const orgId = link.org_id
  if (!op.ready || !op.account) return { ok: false, status: 503, error: 'Online payment is not available right now. Please contact us.' }
  if (link.kind !== 'invoice' || !link.invoice_id) return { ok: false, status: 404, error: 'Link not found' }
  const invoice = await findOrgInvoice(admin, link.invoice_id, orgId)
  if (!invoice) return { ok: false, status: 404, error: 'Link not found' }
  if (invoice.status === 'void') return { ok: false, status: 409, error: 'This invoice was cancelled' }
  // A job invoice must be issued first (no-job invoices are issued by the payment itself, like "Mark paid").
  if (invoice.status === 'draft' && invoice.job_id) return { ok: false, status: 409, error: 'This invoice is not ready yet' }
  const pay = await payableCents(admin, orgId, invoice.id)
  const amount = chargeAmountCents(pay.payableCents, req.amountCents ?? null, op.settings)
  if (!amount.ok) return { ok: false, status: pay.payableCents <= 0 ? 409 : 400, error: pay.payableCents <= 0 && pay.processingCents > 0 ? 'A bank payment for this invoice is already on its way' : amount.error }

  const customerId = await invoiceCustomerId(admin, orgId, invoice)
  const saveCard = !!req.saveCard && op.settings.autopay && !invoice.job_id && !!customerId
  // org-scope-ok: invoice was found in orgId by findOrgInvoice just above
  const { data: inv } = await admin.from('job_invoices').select('invoice_number').eq('id', invoice.id).maybeSingle()
  const number = (inv as { invoice_number?: string } | null)?.invoice_number ?? 'Invoice'
  const accountId = op.account.account_id
  const fee = applicationFeeCents(amount.cents)
  const stripeCustomer = saveCard && customerId ? await ensureStripeCustomer(admin, orgId, accountId, customerId) : null

  // One open Stripe page per invoice: a second tab / a second tap closes the earlier page, so the same balance can't be
  // paid twice (best effort; anything that slips through is kept and flagged by the recorder).
  const { data: open } = await orgDb(admin, orgId).from('online_payments').select('id, checkout_session_id').eq('invoice_id', invoice.id).eq('kind', 'checkout').eq('status', 'open')
  for (const o of (open ?? []) as Array<{ id: string; checkout_session_id: string | null }>) {
    if (o.checkout_session_id) {
      await stripeRequest('POST', `/v1/checkout/sessions/${encodeURIComponent(o.checkout_session_id)}/expire`, {}, { account: accountId }).catch(() => null)
    }
    await orgDb(admin, orgId).from('online_payments').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', o.id).eq('status', 'open')
  }

  const { data: row, error } = await orgDb(admin, orgId)
    .from('online_payments')
    .insert({
      account_id: accountId,
      livemode: stripeKeyIsLive(),
      kind: 'checkout',
      invoice_id: invoice.id,
      customer_id: customerId,
      link_id: link.id,
      amount_cents: amount.cents,
      application_fee_cents: fee,
      currency: op.settings.currency,
      status: 'open',
    })
    .select('id')
    .single()
  if (error || !row) throw new Error(`Could not start the payment: ${error?.message ?? 'unknown'}`)
  const rowId = (row as { id: string }).id
  const metadata = {
    crm_org_id: orgId,
    invoice_id: invoice.id,
    link_id: link.id,
    online_payment_id: rowId,
    kind: 'checkout',
    ...(saveCard ? { save_card: '1', consent: autopayConsentText(req.companyName) } : {}),
  }
  const session = await createSession(
    {
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: op.settings.currency, unit_amount: amount.cents, product_data: { name: `Invoice ${number}` } } }],
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      client_reference_id: invoice.id,
      expires_at: Math.floor(now.getTime() / 1000) + SESSION_MINUTES * 60,
      ...(stripeCustomer ? { customer: stripeCustomer } : {}),
      metadata,
      payment_intent_data: {
        description: `Invoice ${number}`,
        metadata,
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
        ...(saveCard ? { setup_future_usage: 'off_session' } : {}),
      },
    },
    accountId,
    `checkout:${rowId}`,
    op.settings.bankPayments && !saveCard
  )
  await orgDb(admin, orgId).from('online_payments').update({ checkout_session_id: String(session.id), updated_at: new Date().toISOString() }).eq('id', rowId)
  if (typeof session.url !== 'string') return { ok: false, status: 503, error: 'Online payment is not available right now' }
  return { ok: true, url: session.url }
}

/** Save a card (Checkout in setup mode = a SetupIntent on the company's account) for automatic payments. */
export async function createSaveCardCheckout(
  admin: SupabaseClient,
  op: OnlinePayments,
  link: PaymentLinkRow,
  req: { companyName: string },
  urls: { successUrl: string; cancelUrl: string },
  now: Date = new Date()
): Promise<CheckoutResult> {
  const orgId = link.org_id
  if (!op.ready || !op.account || !op.settings.autopay) return { ok: false, status: 503, error: 'Saving a card is not available right now. Please contact us.' }
  if (link.kind !== 'save_card' || !link.customer_id) return { ok: false, status: 404, error: 'Link not found' }
  const accountId = op.account.account_id
  const stripeCustomer = await ensureStripeCustomer(admin, orgId, accountId, link.customer_id)
  const metadata = { crm_org_id: orgId, customer_id: link.customer_id, link_id: link.id, kind: 'save_card', consent: autopayConsentText(req.companyName) }
  const session = await stripeRequest(
    'POST',
    '/v1/checkout/sessions',
    {
      mode: 'setup',
      currency: op.settings.currency,
      customer: stripeCustomer,
      payment_method_types: ['card'],
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      expires_at: Math.floor(now.getTime() / 1000) + SESSION_MINUTES * 60,
      metadata,
      setup_intent_data: { metadata, description: 'Card for automatic payments' },
    },
    { account: accountId, idempotencyKey: `save-card:${link.id}:${Math.floor(now.getTime() / 60000)}` }
  )
  if (typeof session.url !== 'string') return { ok: false, status: 503, error: 'Saving a card is not available right now' }
  return { ok: true, url: session.url }
}
