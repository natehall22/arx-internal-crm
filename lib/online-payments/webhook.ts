/**
 * Stripe Connect webhook: one endpoint for every company. Signature checked first (STRIPE_WEBHOOK_SECRET, raw body),
 * each event handled once by id (`stripe_webhook_events`; the handlers are idempotent anyway), the company resolved
 * from the connected account (`event.account` → payment_accounts.account_id) and nothing else. Platform events with no
 * account and accounts we don't know are acknowledged and ignored. A handler error → 500 so Stripe retries.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { StripeObject } from '@/lib/stripe/api'
import { applyAccountUpdate, findAccountByStripeId, markAccountDisconnected } from '@/lib/online-payments/accounts'
import { notifyOfficeOfPaymentProblem } from '@/lib/online-payments/notify'
import {
  expireCheckoutSession,
  fetchIntent,
  fulfillCheckoutSession,
  recordFailedIntent,
  recordSucceededIntent,
  syncRefunds,
} from '@/lib/online-payments/record'

/** Events the endpoint should be subscribed to (docs/online-payments.md lists the same). */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.refund.updated',
  'charge.dispute.created',
  'account.updated',
  'account.application.deauthorized',
] as const

export type WebhookResult = { status: number; body: Record<string, unknown> }

const IN_FLIGHT_MS = 2 * 60_000

export async function handleStripeWebhookEvent(admin: SupabaseClient, event: StripeObject, now: Date = new Date()): Promise<WebhookResult> {
  const id = typeof event.id === 'string' ? event.id : ''
  const type = typeof event.type === 'string' ? event.type : ''
  if (!/^evt_[A-Za-z0-9_]+$/.test(id) || !type) return { status: 400, body: { error: 'Not a Stripe event' } }
  const accountId = typeof event.account === 'string' ? event.account : null
  const account = accountId ? await findAccountByStripeId(admin, accountId) : null

  // Seen before? done/ignored → acknowledge; still running elsewhere → ask Stripe to come back; failed → run again.
  // org-scope-ok: keyed by Stripe's own event id (the company comes from the connected account, resolved above)
  const { error: insertError } = await admin.from('stripe_webhook_events').insert({
    event_id: id,
    type,
    account_id: accountId,
    org_id: account?.org_id ?? null,
    livemode: !!event.livemode,
    status: 'processing',
    received_at: now.toISOString(),
  })
  if (insertError) {
    if (insertError.code !== '23505') throw new Error(`stripe_webhook_events: ${insertError.message}`)
    // org-scope-ok: Stripe event id
    const { data: seen } = await admin.from('stripe_webhook_events').select('status, attempts, received_at').eq('event_id', id).maybeSingle()
    const s = seen as { status: string; attempts: number; received_at: string } | null
    if (s && (s.status === 'done' || s.status === 'ignored')) return { status: 200, body: { received: true, duplicate: true } }
    if (s && s.status === 'processing' && now.getTime() - Date.parse(s.received_at) < IN_FLIGHT_MS) return { status: 409, body: { error: 'Already processing' } }
    // org-scope-ok: Stripe event id
    await admin.from('stripe_webhook_events').update({ status: 'processing', attempts: (s?.attempts ?? 1) + 1, received_at: now.toISOString(), error: null }).eq('event_id', id)
  }

  const finish = async (status: 'done' | 'ignored' | 'failed', error: string | null = null) => {
    // org-scope-ok: Stripe event id
    await admin.from('stripe_webhook_events').update({ status, error: error?.slice(0, 500) ?? null, processed_at: new Date().toISOString() }).eq('event_id', id)
  }

  if (!account) {
    await finish('ignored', accountId ? 'unknown connected account' : 'platform event')
    return { status: 200, body: { received: true, ignored: true } }
  }

  try {
    const handled = await dispatch(admin, account, type, (event.data?.object ?? {}) as StripeObject, now)
    await finish(handled ? 'done' : 'ignored')
    return { status: 200, body: { received: true } }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    console.error('stripe webhook: handler failed', type, id, msg)
    await finish('failed', msg)
    return { status: 500, body: { error: 'Handler failed; Stripe will retry' } }
  }
}

async function dispatch(
  admin: SupabaseClient,
  account: NonNullable<Awaited<ReturnType<typeof findAccountByStripeId>>>,
  type: string,
  obj: StripeObject,
  now: Date
): Promise<boolean> {
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
      await fulfillCheckoutSession(admin, account, String(obj.id), now)
      return true
    case 'checkout.session.expired':
      await expireCheckoutSession(admin, account, String(obj.id))
      return true
    case 'payment_intent.succeeded':
      await recordSucceededIntent(admin, account, await fetchIntent(account, String(obj.id)), { now })
      return true
    case 'payment_intent.payment_failed':
      await recordFailedIntent(admin, account, await fetchIntent(account, String(obj.id)), now)
      return true
    case 'charge.refunded':
    case 'charge.refund.updated': {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : typeof obj.payment_intent?.id === 'string' ? obj.payment_intent.id : null
      if (!pi) return false
      await syncRefunds(admin, account, pi)
      return true
    }
    case 'charge.dispute.created': {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : null
      if (!pi) return false
      const full = await fetchIntent(account, pi)
      const invoiceId = (full.metadata ?? {}).invoice_id
      if (full.metadata?.crm_org_id !== account.org_id || typeof invoiceId !== 'string') return false
      await notifyOfficeOfPaymentProblem(admin, account.org_id, {
        problem: 'dispute',
        invoiceId,
        amountCents: Number(obj.amount) || 0,
        detail: `The customer disputed the payment with their bank (reason: ${String(obj.reason ?? 'not given')}). Respond in your Stripe dashboard before the deadline.`,
      })
      return true
    }
    case 'account.updated':
      await applyAccountUpdate(admin, account, obj)
      return true
    case 'account.application.deauthorized':
      await markAccountDisconnected(admin, account, 'The company disconnected the platform in Stripe')
      return true
    default:
      return false
  }
}
