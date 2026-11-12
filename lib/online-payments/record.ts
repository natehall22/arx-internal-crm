/**
 * THE recorder of online money. Every way Stripe tells us something — the webhook, the customer landing back on the pay
 * page, an automatic charge answering at once — ends here, and every path is safe to run twice or at the same time:
 *
 * - Money in goes to the ONE existing writer for its invoice: a job invoice → `recordJobPayment` (lib/job-payment-record.ts:
 *   job_payments row, QuickBooks outbox `payment.recorded`, office email) then `applyPaymentToInvoice`; an invoice without
 *   a job → `recordCustomerInvoicePayment` (SQL, invoice locked). Both are keyed by `stripe:<payment intent>`, so a repeat
 *   writes nothing. "Paid in full" is then the usual rule (lib/job-collection.ts / invoice balance) — nothing is stored.
 * - Refunds are NEGATIVE payments keyed by `stripe-refund:<refund id>` (never a delete), taken back off the invoice.
 * - The amount is Stripe's (`amount_received`, re-read from Stripe with the company's account), never the event body or
 *   the browser. An object is only accepted when its metadata names the same company as the connected account.
 * - Money that cannot go on its invoice (void meanwhile, already paid in cash) is never lost: the row is `needs_review`
 *   and the office is emailed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import {
  applyPaymentToInvoice,
  applyRefundToInvoice,
  computeInvoiceBalance,
  findOrgInvoice,
  recordCustomerInvoicePayment,
  recordCustomerInvoiceRefund,
} from '@/lib/invoices'
import { recordJobPayment } from '@/lib/job-payment-record'
import { ymdInZone } from '@/lib/payroll-week-schedule'
import { orgDb } from '@/lib/supabase/org-db'
import { stripeRequest, type StripeObject } from '@/lib/stripe/api'
import type { PaymentType } from '@/lib/types/job-payments'
import type { InvoiceKind } from '@/lib/types/invoices'
import type { PaymentAccountRow } from '@/lib/online-payments/accounts'
import { cardLabel, saveCardOnFile } from '@/lib/online-payments/cards'
import { notifyCustomerOfFailedPayment, notifyOfficeOfPaymentProblem } from '@/lib/online-payments/notify'
import { nextRetryAt, readOnlinePaymentSettings } from '@/lib/online-payments/settings'

export type OnlinePaymentRow = {
  id: string
  org_id: string
  account_id: string
  kind: 'checkout' | 'autopay'
  invoice_id: string
  customer_id: string | null
  link_id: string | null
  checkout_session_id: string | null
  payment_intent_id: string | null
  amount_cents: number
  currency: string | null
  status: 'open' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'needs_review'
  job_payment_id: string | null
  refunded_cents: number
  attempt: number
  recording_at: string | null
}

export const ONLINE_PAYMENT_COLS =
  'id, org_id, account_id, kind, invoice_id, customer_id, link_id, checkout_session_id, payment_intent_id, amount_cents, currency, status, job_payment_id, refunded_cents, attempt, recording_at'

/** A recorder that died mid-way frees its claim after this long. */
const RECORDING_LEASE_MS = 2 * 60_000

export type RecordOutcome = 'recorded' | 'already' | 'busy' | 'processing' | 'needs_review' | 'ignored'

function md(o: StripeObject | null | undefined): Record<string, string> {
  return (o?.metadata && typeof o.metadata === 'object' ? o.metadata : {}) as Record<string, string>
}

/** Pure: our payment type for an invoice kind (deposit invoices are deposits). */
export function paymentTypeForInvoice(kind: InvoiceKind | string | null | undefined): PaymentType {
  return kind === 'deposit' ? 'deposit' : kind === 'final' ? 'final' : 'other'
}

/** Pure: how it was paid + what the office reads in the payment note. */
export function describeCharge(charge: StripeObject | null | undefined, piId: string): { method: 'card' | 'ach'; brand: string | null; last4: string | null; note: string } {
  const details = (charge?.payment_method_details ?? {}) as StripeObject
  if (details.type === 'us_bank_account') {
    const bank = (details.us_bank_account ?? {}) as StripeObject
    const last4 = typeof bank.last4 === 'string' ? bank.last4 : null
    return { method: 'ach', brand: null, last4, note: `Paid online by bank${last4 ? ` •••• ${last4}` : ''} (Stripe ${piId})` }
  }
  const card = (details.card ?? {}) as StripeObject
  const brand = typeof card.brand === 'string' ? card.brand : null
  const last4 = typeof card.last4 === 'string' ? card.last4 : null
  return { method: 'card', brand, last4, note: `Paid online by ${cardLabel({ brand, last4 })} (Stripe ${piId})` }
}

async function loadRow(admin: SupabaseClient, orgId: string, field: 'id' | 'payment_intent_id' | 'checkout_session_id', value: string): Promise<OnlinePaymentRow | null> {
  const { data } = await orgDb(admin, orgId).from('online_payments').select(ONLINE_PAYMENT_COLS).eq(field, value).maybeSingle()
  return (data as OnlinePaymentRow | null) ?? null
}

async function patchRow(admin: SupabaseClient, orgId: string, id: string, patch: Record<string, unknown>): Promise<void> {
  await orgDb(admin, orgId).from('online_payments').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
}

/** The metadata on a Stripe object must name the company that owns the connected account it came from. */
function sameCompany(o: StripeObject, account: Pick<PaymentAccountRow, 'org_id'>): boolean {
  return md(o).crm_org_id === account.org_id
}

/**
 * Find the attempt row for a PaymentIntent: by its id, else the Checkout row it came from (linked now), else a new row
 * from the metadata (the session row was never written). Null when the intent is not ours.
 */
async function rowForIntent(admin: SupabaseClient, account: PaymentAccountRow, pi: StripeObject, sessionId?: string | null): Promise<OnlinePaymentRow | null> {
  const orgId = account.org_id
  const piId = String(pi.id)
  const byPi = await loadRow(admin, orgId, 'payment_intent_id', piId)
  if (byPi) return byPi
  const meta = md(pi)
  if (meta.online_payment_id) {
    const r = await loadRow(admin, orgId, 'id', meta.online_payment_id)
    if (r) {
      if (!r.payment_intent_id) await patchRow(admin, orgId, r.id, { payment_intent_id: piId })
      return { ...r, payment_intent_id: piId }
    }
  }
  if (sessionId) {
    const bySession = await loadRow(admin, orgId, 'checkout_session_id', sessionId)
    if (bySession) {
      if (!bySession.payment_intent_id) await patchRow(admin, orgId, bySession.id, { payment_intent_id: piId })
      return { ...bySession, payment_intent_id: piId }
    }
  }
  const invoice = meta.invoice_id ? await findOrgInvoice(admin, meta.invoice_id, orgId) : null
  if (!invoice) return null
  const amount = Number(pi.amount_received || pi.amount)
  if (!Number.isInteger(amount) || amount <= 0) return null
  const { data, error } = await orgDb(admin, orgId)
    .from('online_payments')
    .insert({
      account_id: account.account_id,
      livemode: !!pi.livemode,
      kind: meta.kind === 'autopay' ? 'autopay' : 'checkout',
      invoice_id: invoice.id,
      customer_id: invoice.customer_id ?? null,
      checkout_session_id: sessionId ?? null,
      payment_intent_id: piId,
      amount_cents: amount,
      status: 'open',
      attempt: Math.max(1, Number(meta.attempt) || 1),
    })
    .select(ONLINE_PAYMENT_COLS)
    .single()
  if (error) return loadRow(admin, orgId, 'payment_intent_id', piId) // a parallel delivery made it
  return data as OnlinePaymentRow
}

/** Claim the right to record this row (one recorder at a time; a dead claim expires). */
async function claim(admin: SupabaseClient, row: OnlinePaymentRow, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - RECORDING_LEASE_MS).toISOString()
  const { data } = await orgDb(admin, row.org_id)
    .from('online_payments')
    .update({ recording_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', row.id)
    .is('job_payment_id', null)
    .or(`recording_at.is.null,recording_at.lt."${stale}"`)
    .select('id')
  return ((data ?? []) as unknown[]).length === 1
}

/**
 * A PaymentIntent that SUCCEEDED (re-read from Stripe by the caller, `latest_charge` expanded): record the money once.
 */
export async function recordSucceededIntent(
  admin: SupabaseClient,
  account: PaymentAccountRow,
  pi: StripeObject,
  opts: { sessionId?: string | null; now?: Date } = {}
): Promise<RecordOutcome> {
  if (pi.status !== 'succeeded' || !sameCompany(pi, account)) return 'ignored'
  const orgId = account.org_id
  const now = opts.now ?? new Date()
  const row = await rowForIntent(admin, account, pi, opts.sessionId)
  if (!row) return 'ignored'
  if (row.job_payment_id || row.status === 'needs_review') return 'already'
  if (!(await claim(admin, row, now))) return 'busy'

  const amount = Number(pi.amount_received)
  const charge = (typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge : null) as StripeObject | null
  const how = describeCharge(charge, String(pi.id))
  const tz = await loadOrgTimeZone(admin, orgId)
  const paidAt = ymdInZone(new Date(((charge?.created as number) ?? (pi.created as number) ?? now.getTime() / 1000) * 1000), tz)
  const key = `stripe:${pi.id}`
  const base = { method: how.method, card_brand: how.brand, card_last4: how.last4, amount_cents: amount, recording_at: null }

  const invoice = await findOrgInvoice(admin, row.invoice_id, orgId)
  const review = async (reason: string, jobPaymentId: string | null = null) => {
    await patchRow(admin, orgId, row.id, { ...base, status: 'needs_review', review_reason: reason.slice(0, 300), job_payment_id: jobPaymentId, succeeded_at: now.toISOString() })
    await notifyOfficeOfPaymentProblem(admin, orgId, {
      problem: 'needs_review',
      invoiceId: row.invoice_id,
      amountCents: amount,
      detail: `${how.note}. It was taken, but it could not be put on the invoice: ${reason} Decide whether to refund it in Stripe or apply it.`,
    })
    return 'needs_review' as const
  }
  if (!invoice || !Number.isInteger(amount) || amount <= 0) return review('the invoice was not found.')
  // The attempt's own currency (saved when it started), else the company's: anything else is never recorded.
  const currency = row.currency || (await companyCurrency(admin, orgId))
  if (String(pi.currency ?? '').toLowerCase() !== currency) return review(`it was paid in ${String(pi.currency ?? '?').toUpperCase()}, but the company takes ${currency.toUpperCase()}.`)

  let jobPaymentId: string
  if (invoice.job_id) {
    // org-scope-ok: invoice was found in orgId by findOrgInvoice just above
    const { data: inv } = await admin.from('job_invoices').select('invoice_kind').eq('id', invoice.id).maybeSingle()
    const res = await recordJobPayment(admin, {
      orgId,
      jobId: invoice.job_id,
      paidAt,
      amountCents: amount,
      paymentType: paymentTypeForInvoice((inv as { invoice_kind?: string } | null)?.invoice_kind),
      method: how.method,
      payer: 'homeowner',
      note: how.note,
      createdBy: null,
      idempotencyKey: key,
    })
    if (!res.ok) {
      await patchRow(admin, orgId, row.id, { recording_at: null })
      throw new Error(`recordSucceededIntent: job payment not written (${res.error})`)
    }
    jobPaymentId = res.payment.id
    // The money counts on the job either way; putting it on THIS invoice is the second step.
    try {
      const { data: applied } = await admin.from('invoice_payments').select('id').eq('invoice_id', invoice.id).eq('job_payment_id', jobPaymentId).maybeSingle()
      if (!applied) {
        const bal = await computeInvoiceBalance(admin, invoice.id)
        const take = Math.min(amount, bal.balance_cents)
        if (take <= 0) return review('the invoice was already paid. The payment counts on the job.', jobPaymentId)
        await applyPaymentToInvoice(admin, orgId, invoice.id, jobPaymentId, take)
        if (take < amount) return review(`only ${(take / 100).toFixed(2)} was owed on the invoice. The rest counts on the job.`, jobPaymentId)
      }
    } catch (e) {
      return review(`${(e as Error).message}. The payment counts on the job.`, jobPaymentId)
    }
  } else {
    const res = await recordCustomerInvoicePayment(admin, orgId, invoice.id, {
      amountCents: amount,
      paidAt,
      method: how.method,
      note: how.note,
      createdBy: null,
      idempotencyKey: key,
    })
    if (!res.ok) return review(`${res.error}.`)
    jobPaymentId = res.paymentId
  }

  await patchRow(admin, orgId, row.id, { ...base, status: 'succeeded', job_payment_id: jobPaymentId, succeeded_at: now.toISOString() })
  // A paid invoice needs no more automatic retries.
  await orgDb(admin, orgId).from('online_payments').update({ next_retry_at: null }).eq('invoice_id', row.invoice_id).not('next_retry_at', 'is', null)

  // "Save this card for automatic payments" ticked on the pay page (consent words travel in the metadata).
  const meta = md(pi)
  if (meta.save_card === '1' && row.customer_id && typeof pi.customer === 'string' && typeof pi.payment_method === 'string') {
    await saveCardOnFile(admin, orgId, account.account_id, {
      customerId: row.customer_id,
      stripeCustomerId: pi.customer,
      paymentMethodId: pi.payment_method,
      consentText: meta.consent || 'Saved on the pay page',
    }).catch((e) => console.error('recordSucceededIntent: saving the card failed', e))
  }
  return 'recorded'
}

/** A bank payment was submitted and is clearing (ACH takes days): the office sees "processing", nothing is recorded yet. */
export async function markProcessing(admin: SupabaseClient, account: PaymentAccountRow, pi: StripeObject, sessionId?: string | null): Promise<RecordOutcome> {
  if (!sameCompany(pi, account)) return 'ignored'
  const row = await rowForIntent(admin, account, pi, sessionId)
  if (!row) return 'ignored'
  if (row.job_payment_id || row.status === 'succeeded') return 'already'
  const how = describeCharge((typeof pi.latest_charge === 'object' ? pi.latest_charge : null) as StripeObject | null, String(pi.id))
  await patchRow(admin, account.org_id, row.id, { status: 'processing', method: how.method, card_last4: how.last4 })
  return 'processing'
}

/**
 * A payment did not go through. In Checkout a declined card just lets the customer try again on the same page, so an
 * open checkout row is left alone; what matters is an automatic charge (retry + tell customer and office) or a bank
 * payment that bounced after the customer left.
 */
export async function recordFailedIntent(admin: SupabaseClient, account: PaymentAccountRow, pi: StripeObject, now: Date = new Date()): Promise<RecordOutcome> {
  if (!sameCompany(pi, account)) return 'ignored'
  const orgId = account.org_id
  const row = await rowForIntent(admin, account, pi)
  if (!row) return 'ignored'
  if (row.job_payment_id || row.status === 'succeeded' || row.status === 'failed') return 'already'
  const isAutopay = row.kind === 'autopay'
  if (!isAutopay && row.status !== 'processing') return 'ignored'
  const err = (pi.last_payment_error ?? {}) as StripeObject
  const code = typeof err.decline_code === 'string' ? err.decline_code : typeof err.code === 'string' ? err.code : null
  const message = typeof err.message === 'string' ? err.message : 'The payment was declined'
  return failRow(admin, orgId, row, { code, message }, now)
}

/** Shared by the webhook and the immediate answer of an automatic charge. */
export async function failRow(
  admin: SupabaseClient,
  orgId: string,
  row: Pick<OnlinePaymentRow, 'id' | 'kind' | 'invoice_id' | 'amount_cents' | 'attempt'>,
  err: { code: string | null; message: string },
  now: Date
): Promise<RecordOutcome> {
  const { data: org } = await admin.from('orgs').select('online:settings->onlinePayments').eq('id', orgId).maybeSingle()
  const settings = readOnlinePaymentSettings((org as { online?: unknown } | null)?.online ?? {})
  const retry = row.kind === 'autopay' ? nextRetryAt(row.attempt, settings, now) : null
  // Claim the failure once (a webhook and the direct answer can both report it).
  const { data } = await orgDb(admin, orgId)
    .from('online_payments')
    .update({ status: 'failed', failure_code: err.code, failure_message: err.message.slice(0, 300), next_retry_at: retry?.toISOString() ?? null, recording_at: null, updated_at: now.toISOString() })
    .eq('id', row.id)
    .neq('status', 'failed')
    .is('job_payment_id', null)
    .select('id')
  if (((data ?? []) as unknown[]).length === 0) return 'already'
  const kind = row.kind === 'autopay' ? 'autopay' : 'bank'
  await Promise.all([
    notifyCustomerOfFailedPayment(admin, orgId, { invoiceId: row.invoice_id, kind, nextTry: retry }),
    notifyOfficeOfPaymentProblem(admin, orgId, {
      problem: kind === 'autopay' ? 'autopay_failed' : 'bank_failed',
      invoiceId: row.invoice_id,
      amountCents: row.amount_cents,
      detail: `Reason: ${err.message}. The invoice stays open and the customer was emailed a pay link.`,
      nextTry: retry,
    }),
  ])
  return 'recorded'
}

/**
 * Pure: how much of a reversal (refund or lost dispute) comes back off the invoice. Money the payment took that never
 * went on the invoice (an overpayment) is given back FIRST and takes nothing back; after that each cent reverses an
 * applied cent, never more than the payment applied. `previous` = reversals of this payment already counted.
 */
export function refundTakeBack(chargedCents: number, appliedCents: number, previousCents: number, amountCents: number): number {
  const applied = Math.max(0, appliedCents)
  const excess = Math.max(0, chargedCents - applied)
  const counted = (x: number) => Math.min(applied, Math.max(0, x - excess))
  return counted(previousCents + amountCents) - counted(previousCents)
}

type Reversal = { key: string; kind: 'refund' | 'dispute'; amount: number; created: number }

/**
 * Bring our reversals up to Stripe's for one payment: every SUCCEEDED refund and every LOST dispute is one negative
 * payment (keyed `stripe-refund:<id>` / `stripe-dispute:<id>`; QuickBooks outbox `payment.refunded` / `payment.disputed`
 * for job payments), and comes back off the invoice only as far as THIS payment applied to it (`refundTakeBack`) — an
 * overpayment refund or a repeat never re-opens a paid invoice. Safe to run any number of times. A reversal of a payment
 * not recorded yet throws (the webhook answers 500 and Stripe retries after the payment's own event).
 */
export async function syncReversals(admin: SupabaseClient, account: PaymentAccountRow, paymentIntentId: string): Promise<RecordOutcome> {
  const orgId = account.org_id
  const row = await loadRow(admin, orgId, 'payment_intent_id', paymentIntentId)
  if (!row) return 'ignored'
  if (!row.job_payment_id) {
    // Money the office is already reviewing (it never went on an invoice): the reversal is theirs to match up.
    if (row.status === 'needs_review') {
      await notifyOfficeOfPaymentProblem(admin, orgId, { problem: 'needs_review', invoiceId: row.invoice_id, amountCents: row.amount_cents, detail: 'A payment you were asked to review was refunded or disputed in Stripe. Nothing was changed in the CRM.' })
      return 'needs_review'
    }
    throw new Error('reversal before its payment was recorded — retry later')
  }
  const [refundList, disputeList] = await Promise.all([
    stripeRequest('GET', '/v1/refunds', { payment_intent: paymentIntentId, limit: 100 }, { account: account.account_id }),
    stripeRequest('GET', '/v1/disputes', { payment_intent: paymentIntentId, limit: 100 }, { account: account.account_id }),
  ])
  const reversals: Reversal[] = [
    ...((refundList.data ?? []) as StripeObject[]).filter((r) => r.status === 'succeeded' && Number(r.amount) > 0).map((r) => ({ key: `stripe-refund:${r.id}`, kind: 'refund' as const, amount: Number(r.amount), created: Number(r.created) || 0 })),
    ...((disputeList.data ?? []) as StripeObject[]).filter((d) => d.status === 'lost' && Number(d.amount) > 0).map((d) => ({ key: `stripe-dispute:${d.id}`, kind: 'dispute' as const, amount: Number(d.amount), created: Number(d.created) || 0 })),
  ].sort((x, y) => x.created - y.created || x.key.localeCompare(y.key))
  const invoice = await findOrgInvoice(admin, row.invoice_id, orgId)
  if (!invoice) return 'ignored'
  const tz = await loadOrgTimeZone(admin, orgId)
  // org-scope-ok: job_payment_id was written by this company's recorder on a row loaded in orgId
  const { data: orig } = await admin.from('job_payments').select('payment_type, method').eq('id', row.job_payment_id).maybeSingle()
  const o = (orig ?? {}) as { payment_type?: PaymentType; method?: 'card' | 'ach' }
  const method = o.method === 'ach' ? 'ach' : 'card'
  // What THIS payment put on THIS invoice (its own positive application).
  const { data: apps } = await admin.from('invoice_payments').select('applied_cents').eq('invoice_id', invoice.id).eq('job_payment_id', row.job_payment_id)
  const applied = ((apps ?? []) as Array<{ applied_cents: number }>).reduce((t, a) => t + Number(a.applied_cents), 0)
  // NOT incremental: the target is worked out from ALL reversals of this payment at once, so the order Stripe tells us
  // about them in (or a retry) never changes the answer. Already taken back = this payment's reversal rows already on
  // the invoice; what is still owed back off the invoice is shared over the reversals not yet on it.
  const total = reversals.reduce((t, r) => t + r.amount, 0)
  const target = refundTakeBack(row.amount_cents, applied, 0, total)
  const keys = reversals.map((r) => r.key)
  const existing = keys.length === 0 ? [] : ((await (invoice.job_id
    ? // org-scope-ok: the job is this invoice's, found in orgId by findOrgInvoice above
      admin.from('job_payments').select('id, idempotency_key').eq('job_id', invoice.job_id).in('idempotency_key', keys)
    : admin.from('job_payments').select('id, idempotency_key').eq('org_id', orgId).is('job_id', null).in('idempotency_key', keys))).data ?? []) as Array<{ id: string; idempotency_key: string }>
  const onInvoice = existing.length === 0 ? [] : ((await admin.from('invoice_payments').select('job_payment_id, applied_cents').eq('invoice_id', invoice.id).in('job_payment_id', existing.map((e) => e.id))).data ?? []) as Array<{ job_payment_id: string; applied_cents: number }>
  const appliedByPayment = new Map(onInvoice.map((x) => [x.job_payment_id, -Number(x.applied_cents)]))
  const keyToPayment = new Map(existing.map((e) => [e.idempotency_key, e.id]))
  let remaining = Math.max(0, target - onInvoice.reduce((t, x) => t + -Number(x.applied_cents), 0))
  let problems = 0
  // auto = the job is billed by the hour, so recordJobPayment already took the commission back through the commission
  // change lines (lib/payroll-commission-change.ts); fixed-price jobs keep the review flag (Nathan's call pending).
  const newlyLost: Array<Reversal & { auto: boolean }> = []
  for (const r of reversals) {
    const known = keyToPayment.get(r.key)
    const alreadyOn = known != null && appliedByPayment.has(known)
    const take = alreadyOn ? 0 : Math.min(r.amount, remaining)
    remaining -= take
    const paidAt = ymdInZone(new Date(r.created * 1000), tz)
    const note = `${r.kind === 'refund' ? 'Refund' : 'Dispute lost'} (Stripe ${r.key.split(':')[1]})`
    if (invoice.job_id) {
      const res = await recordJobPayment(admin, {
        orgId,
        jobId: invoice.job_id,
        paidAt,
        amountCents: -r.amount,
        paymentType: o.payment_type ?? 'other',
        method,
        payer: 'homeowner',
        note,
        createdBy: null,
        idempotencyKey: r.key,
        eventType: r.kind === 'refund' ? 'payment.refunded' : 'payment.disputed',
      })
      if (!res.ok) throw new Error(`syncReversals: job reversal not written (${res.error})`)
      if (!res.duplicate && r.kind === 'dispute') newlyLost.push({ ...r, auto: res.commissionFollowsPayments })
      if (take > 0) await applyRefundToInvoice(admin, orgId, invoice.id, res.payment.id, take)
    } else if (!known) {
      const res = await recordCustomerInvoiceRefund(admin, orgId, invoice.id, { amountCents: r.amount, paidAt, method, note, idempotencyKey: r.key, unapplyCents: take })
      if (!res.ok) problems++
      else if (!res.duplicate && r.kind === 'dispute') newlyLost.push({ ...r, auto: false })
    }
  }
  await patchRow(admin, orgId, row.id, {
    refunded_cents: reversals.filter((r) => r.kind === 'refund').reduce((t, r) => t + r.amount, 0),
    disputed_cents: reversals.filter((r) => r.kind === 'dispute').reduce((t, r) => t + r.amount, 0),
  })
  for (const r of newlyLost) {
    // A job already collected or already in a payroll week: commissions were (or will be) paid on money that is gone.
    const paidOut = invoice.job_id ? await jobAlreadyPaidOut(admin, orgId, invoice.job_id) : null
    if (paidOut && !r.auto) {
      await orgDb(admin, orgId).from('online_payments').update({ reversal_flag: `Dispute lost ${(r.amount / 100).toFixed(2)} — ${paidOut}: check commission`, reversed_at: new Date().toISOString() }).eq('id', row.id)
    }
    await notifyOfficeOfPaymentProblem(admin, orgId, {
      problem: 'dispute',
      invoiceId: row.invoice_id,
      amountCents: r.amount,
      detail: `The dispute was lost: the bank took the money back. It is recorded as a negative payment and the invoice is open again for that amount.${paidOut ? (r.auto ? ` The job was ${paidOut} — it is billed by the hour, so the commission on this money comes back off automatically on the next pay week (Payroll → commission changes).` : ` The job was ${paidOut} — review commission (Payroll → Fix a mistake).`) : ''}`,
    })
  }
  if (problems > 0) {
    await notifyOfficeOfPaymentProblem(admin, orgId, { problem: 'needs_review', invoiceId: row.invoice_id, amountCents: total, detail: 'A refund or dispute in Stripe could not be matched to this invoice in the CRM. Check the invoice.' })
    return 'needs_review'
  }
  return 'recorded'
}

/**
 * Was this job's money already counted for pay? Collected / complete, or its commission is in a payroll week that is
 * locked or paid. Returns the plain reason, or null. (Reading the payroll tables is best effort: a failure = not known.)
 */
/** Why a job's money is already settled in pay (an approved payroll week / collected), or null. Also used by "Undo payment" (lib/job-payment-undo.ts). */
export async function jobAlreadyPaidOut(admin: SupabaseClient, orgId: string, jobId: string): Promise<string | null> {
  const { data: job } = await orgDb(admin, orgId).from('production_jobs').select('status').eq('id', jobId).maybeSingle()
  const status = (job as { status?: string } | null)?.status
  // org-scope-ok: jobId is this company's job (its invoice was found in orgId); snapshots hang off it
  const { data: snaps } = await admin.from('payroll_job_snapshots').select('payroll_period_id').eq('job_id', jobId)
  const periodIds = ((snaps ?? []) as Array<{ payroll_period_id: string }>).map((x) => x.payroll_period_id)
  if (periodIds.length > 0) {
    const { data: periods } = await orgDb(admin, orgId).from('payroll_periods').select('status').in('id', periodIds)
    if (((periods ?? []) as Array<{ status: string }>).some((p) => p.status === 'locked' || p.status === 'paid')) return 'already in an approved payroll week'
  }
  if (status === 'collected' || status === 'complete') return 'already collected'
  return null
}

/** The currency the company takes (settings; US companies = usd). A payment in any other currency is never recorded. */
async function companyCurrency(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from('orgs').select('online:settings->onlinePayments').eq('id', orgId).maybeSingle()
  return readOnlinePaymentSettings((data as { online?: unknown } | null)?.online ?? {}).currency
}

/** Re-read a PaymentIntent on the company's account with its charge (the source of truth for amount and card). */
export async function fetchIntent(account: Pick<PaymentAccountRow, 'account_id'>, id: string): Promise<StripeObject> {
  return stripeRequest('GET', `/v1/payment_intents/${encodeURIComponent(id)}`, { expand: ['latest_charge'] }, { account: account.account_id })
}

/**
 * Checkout finished (webhook `checkout.session.completed` / `async_payment_*`, or the customer landing back on the pay
 * page). Re-reads the session from Stripe; pays → recorded, bank pending → processing, saved card → card on file.
 */
export async function fulfillCheckoutSession(admin: SupabaseClient, account: PaymentAccountRow, sessionId: string, now: Date = new Date()): Promise<RecordOutcome> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return 'ignored'
  const s = await stripeRequest('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { expand: ['payment_intent', 'payment_intent.latest_charge', 'setup_intent'] }, { account: account.account_id })
  if (!sameCompany(s, account)) return 'ignored'
  const meta = md(s)
  if (s.mode === 'setup') {
    const si = (typeof s.setup_intent === 'object' ? s.setup_intent : null) as StripeObject | null
    if (s.status !== 'complete' || !si || si.status !== 'succeeded' || !meta.customer_id) return 'ignored'
    const { data: cust } = await orgDb(admin, account.org_id).from('customers').select('id').eq('id', meta.customer_id).maybeSingle()
    if (!cust || typeof si.payment_method !== 'string' || typeof s.customer !== 'string') return 'ignored'
    await saveCardOnFile(admin, account.org_id, account.account_id, {
      customerId: meta.customer_id,
      stripeCustomerId: s.customer,
      paymentMethodId: si.payment_method,
      consentText: meta.consent || 'Saved on the card page',
    })
    // The link stays live until it expires (14 days): the customer lands back on it, and may replace the card again.
    return 'recorded'
  }
  const pi = (typeof s.payment_intent === 'object' ? s.payment_intent : null) as StripeObject | null
  if (!pi) return 'ignored'
  if (s.payment_status === 'paid' && pi.status === 'succeeded') return recordSucceededIntent(admin, account, pi, { sessionId, now })
  if (pi.status === 'processing') return markProcessing(admin, account, pi, sessionId)
  if (s.status === 'complete' && pi.status === 'requires_payment_method') return recordFailedIntent(admin, account, pi, now)
  return 'ignored'
}

/** `checkout.session.expired`: an unpaid open row closes (a new Pay tap makes a new session). */
export async function expireCheckoutSession(admin: SupabaseClient, account: PaymentAccountRow, sessionId: string): Promise<void> {
  await orgDb(admin, account.org_id)
    .from('online_payments')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('checkout_session_id', sessionId)
    .eq('status', 'open')
}
