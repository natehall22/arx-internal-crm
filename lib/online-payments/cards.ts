/**
 * Card on file for automatic payments (service plans). Stripe holds the card; we keep the Stripe customer / payment
 * method ids and the brand, last 4 and expiry to show "Visa •••• 4242" — never a card number (PCI SAQ-A: Stripe-hosted
 * Checkout collects every card). One live card per customer (`customer_payment_methods_one_live`).
 * Turning autopay ON needs the customer's own consent (the save-card page); the office can only turn it OFF or remove it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { orgDb } from '@/lib/supabase/org-db'
import { stripeRequest } from '@/lib/stripe/api'

export type CardOnFile = {
  id: string
  customer_id: string
  account_id: string
  stripe_customer_id: string
  payment_method_id: string
  brand: string | null
  last4: string | null
  exp_month: number | null
  exp_year: number | null
  autopay: boolean
  consent_at: string | null
}

const CARD_COLS = 'id, customer_id, account_id, stripe_customer_id, payment_method_id, brand, last4, exp_month, exp_year, autopay, consent_at'

/** Pure: "Visa •••• 4242". */
export function cardLabel(c: { brand?: string | null; last4?: string | null } | null | undefined): string {
  if (!c?.last4) return 'Card'
  const brand = c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1).replace(/_/g, ' ') : 'Card'
  return `${brand} •••• ${c.last4}`
}

/** Pure: an expired card can't be charged (month granularity). */
export function cardExpired(c: Pick<CardOnFile, 'exp_month' | 'exp_year'>, now: Date): boolean {
  if (!c.exp_month || !c.exp_year) return false
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  return c.exp_year < y || (c.exp_year === y && c.exp_month < m)
}

export async function loadCardOnFile(admin: SupabaseClient, orgId: string, customerId: string): Promise<CardOnFile | null> {
  const { data } = await orgDb(admin, orgId)
    .from('customer_payment_methods')
    .select(CARD_COLS)
    .eq('customer_id', customerId)
    .is('removed_at', null)
    .maybeSingle()
  return (data as CardOnFile | null) ?? null
}

/** The customer's Stripe customer on the company's account, made once (idempotent on Stripe's side too). */
export async function ensureStripeCustomer(admin: SupabaseClient, orgId: string, accountId: string, customerId: string): Promise<string> {
  const db = orgDb(admin, orgId)
  const { data: existing } = await db.from('stripe_customers').select('stripe_customer_id').eq('account_id', accountId).eq('customer_id', customerId).maybeSingle()
  if (existing) return (existing as { stripe_customer_id: string }).stripe_customer_id
  const { data: c } = await db.from('customers').select('id, name, email, phone').eq('id', customerId).maybeSingle()
  if (!c) throw new Error('Customer not found')
  const cust = c as { name?: string | null; email?: string | null; phone?: string | null }
  const created = await stripeRequest(
    'POST',
    '/v1/customers',
    { name: cust.name || undefined, email: cust.email || undefined, phone: cust.phone || undefined, metadata: { crm_customer_id: customerId, crm_org_id: orgId } },
    { account: accountId, idempotencyKey: `customer:${accountId}:${customerId}` }
  )
  const stripeId = String(created.id)
  const { error } = await db.from('stripe_customers').insert({ account_id: accountId, customer_id: customerId, stripe_customer_id: stripeId })
  if (error && error.code !== '23505') throw new Error(`Could not save the Stripe customer: ${error.message}`)
  if (error) {
    const { data: winner } = await db.from('stripe_customers').select('stripe_customer_id').eq('account_id', accountId).eq('customer_id', customerId).maybeSingle()
    if (winner) return (winner as { stripe_customer_id: string }).stripe_customer_id
  }
  return stripeId
}

/**
 * Save the card the customer just entered (from a save-card Checkout or a payment with "save this card"), with their
 * consent words. Replaces the customer's previous card (it is detached at Stripe, best effort). Idempotent: the same
 * payment method twice is one row.
 */
export async function saveCardOnFile(
  admin: SupabaseClient,
  orgId: string,
  accountId: string,
  p: { customerId: string; stripeCustomerId: string; paymentMethodId: string; consentText: string }
): Promise<CardOnFile | null> {
  const db = orgDb(admin, orgId)
  const current = await loadCardOnFile(admin, orgId, p.customerId)
  if (current?.payment_method_id === p.paymentMethodId) return current
  const pm = await stripeRequest('GET', `/v1/payment_methods/${encodeURIComponent(p.paymentMethodId)}`, {}, { account: accountId })
  const card = (pm.card ?? {}) as { brand?: string; last4?: string; exp_month?: number; exp_year?: number }
  if (current) {
    await db.from('customer_payment_methods').update({ removed_at: new Date().toISOString() }).eq('id', current.id).is('removed_at', null)
    await stripeRequest('POST', `/v1/payment_methods/${encodeURIComponent(current.payment_method_id)}/detach`, {}, { account: current.account_id }).catch((e) =>
      console.error('saveCardOnFile: detach old card failed', e)
    )
  }
  const { data, error } = await db
    .from('customer_payment_methods')
    .insert({
      customer_id: p.customerId,
      account_id: accountId,
      stripe_customer_id: p.stripeCustomerId,
      payment_method_id: p.paymentMethodId,
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
      exp_month: card.exp_month ?? null,
      exp_year: card.exp_year ?? null,
      autopay: true,
      consent_at: new Date().toISOString(),
      consent_text: p.consentText.slice(0, 500),
    })
    .select(CARD_COLS)
    .single()
  if (error) {
    if (error.code === '23505') return loadCardOnFile(admin, orgId, p.customerId)
    throw new Error(`Could not save the card: ${error.message}`)
  }
  return data as CardOnFile
}

export async function setAutopayOff(admin: SupabaseClient, orgId: string, customerId: string): Promise<boolean> {
  const { data } = await orgDb(admin, orgId)
    .from('customer_payment_methods')
    .update({ autopay: false })
    .eq('customer_id', customerId)
    .is('removed_at', null)
    .select('id')
  return ((data ?? []) as unknown[]).length > 0
}

export async function removeCardOnFile(admin: SupabaseClient, orgId: string, customerId: string, by: string | null): Promise<boolean> {
  const current = await loadCardOnFile(admin, orgId, customerId)
  if (!current) return false
  await orgDb(admin, orgId).from('customer_payment_methods').update({ removed_at: new Date().toISOString(), removed_by: by, autopay: false }).eq('id', current.id)
  await stripeRequest('POST', `/v1/payment_methods/${encodeURIComponent(current.payment_method_id)}/detach`, {}, { account: current.account_id }).catch((e) =>
    console.error('removeCardOnFile: detach failed (removed in the CRM anyway)', e)
  )
  return true
}
