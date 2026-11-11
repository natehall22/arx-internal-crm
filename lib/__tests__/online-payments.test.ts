/** @jest-environment node */
/**
 * Online payments (Stripe Connect): pure rules + the money flows end to end against an in-memory database and Stripe
 * fixtures served by a mocked `fetch` (the same JSON shapes Stripe returns for API version 2024-06-20). The SQL writers
 * (record_customer_invoice_payment / _refund, the relaxed checks) run for real in supabase/tests/online_payments.test.sql.
 */
import { createHmac } from 'crypto'

import { createFakeDb } from '@/lib/test-helpers/fake-db'

jest.mock('@/lib/company-links', () => ({
  orgAppUrl: async () => 'https://acme.crm.test',
  tryOrgAppUrl: async () => 'https://acme.crm.test',
}))

let mockClient: unknown = null
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => mockClient }))

import { encodeStripeForm, verifyStripeSignature } from '@/lib/stripe/api'
import {
  applicationFeeCents,
  chargeAmountCents,
  nextRetryAt,
  parseOnlinePaymentSettingsPatch,
  platformFeeBps,
  readOnlinePaymentSettings,
} from '@/lib/online-payments/settings'
import { accountStatusFrom, loadOnlinePayments } from '@/lib/online-payments/accounts'
import { cardExpired, cardLabel } from '@/lib/online-payments/cards'
import { describeCharge, paymentTypeForInvoice } from '@/lib/online-payments/record'
import { attemptLabel } from '@/lib/online-payments/summary'
import { createPaymentLink, isWellFormedLinkToken, resolvePaymentLink } from '@/lib/online-payments/links'
import { createInvoiceCheckout } from '@/lib/online-payments/checkout'
import { handleStripeWebhookEvent } from '@/lib/online-payments/webhook'
import { chargeInvoiceAutopay, runAutopayRetries } from '@/lib/online-payments/autopay'
import { POST as webhookPOST } from '@/app/api/webhooks/stripe/route'

const ORG = 'org-acme'
const OTHER = 'org-other'
const ACCT = 'acct_ACME123'
const NOW = new Date('2026-11-12T15:00:00Z')

// ---------------------------------------------------------------------------------------------------------------- pure

describe('Stripe REST encoding + webhook signatures', () => {
  test('bracket form encoding (nested objects, arrays, skips null/undefined)', () => {
    expect(encodeStripeForm({ a: 1, b: { c: 'x y', d: undefined }, e: ['card', 'us_bank_account'], f: [{ g: 2 }], h: null, t: true })).toBe(
      'a=1&b%5Bc%5D=x%20y&e%5B0%5D=card&e%5B1%5D=us_bank_account&f%5B0%5D%5Bg%5D=2&t=true'
    )
  })

  const secret = 'whsec_test_123'
  const sign = (body: string, t: number, s = secret) => `t=${t},v1=${createHmac('sha256', s).update(`${t}.${body}`).digest('hex')}`
  test('accepts a valid signature, any of several v1 values', () => {
    const body = '{"id":"evt_1"}'
    expect(verifyStripeSignature(body, sign(body, 1000), secret, 1000)).toEqual({ ok: true })
    expect(verifyStripeSignature(body, `${sign(body, 1000, 'whsec_old')},${sign(body, 1000).split(',')[1]}`, secret, 1000)).toEqual({ ok: true })
  })
  test('refuses tampered body, wrong secret, stale timestamp, junk header', () => {
    const body = '{"id":"evt_1"}'
    expect(verifyStripeSignature('{"id":"evt_2"}', sign(body, 1000), secret, 1000)).toEqual({ ok: false, reason: 'mismatch' })
    expect(verifyStripeSignature(body, sign(body, 1000, 'whsec_x'), secret, 1000)).toEqual({ ok: false, reason: 'mismatch' })
    expect(verifyStripeSignature(body, sign(body, 1000), secret, 1000 + 301)).toEqual({ ok: false, reason: 'stale' })
    expect(verifyStripeSignature(body, 'garbage', secret, 1000)).toEqual({ ok: false, reason: 'bad_header' })
    expect(verifyStripeSignature(body, null, secret, 1000)).toEqual({ ok: false, reason: 'no_header' })
    expect(verifyStripeSignature(body, sign(body, 1000), '', 1000)).toEqual({ ok: false, reason: 'no_secret' })
  })
})

describe('settings + amounts', () => {
  test('defaults; invalid stored values fall back', () => {
    expect(readOnlinePaymentSettings({})).toEqual({ allowPartial: false, bankPayments: true, autopay: true, retryDays: [3, 7] })
    expect(readOnlinePaymentSettings({ onlinePayments: { allowPartial: true, retryDays: [0, 99] } })).toEqual({ allowPartial: true, bankPayments: true, autopay: true, retryDays: [3, 7] })
  })
  test('patch validation', () => {
    expect(parseOnlinePaymentSettingsPatch({ settings: { allowPartial: true, retryDays: [2] } })).toEqual({ set: { allowPartial: true, retryDays: [2] } })
    expect(parseOnlinePaymentSettingsPatch({ settings: { surcharge: 3 } })).toEqual({ error: 'Unknown setting: surcharge' })
    expect(parseOnlinePaymentSettingsPatch({ settings: { retryDays: [1, 2, 3, 4] } })).toHaveProperty('error')
    expect(parseOnlinePaymentSettingsPatch({ settings: {} })).toEqual({ error: 'Nothing to save' })
  })
  test('what the pay page may charge', () => {
    expect(chargeAmountCents(10000, null, { allowPartial: false })).toEqual({ ok: true, cents: 10000 })
    expect(chargeAmountCents(10000, 5000, { allowPartial: false })).toEqual({ ok: false, error: 'This invoice is paid in full online' })
    expect(chargeAmountCents(10000, 5000, { allowPartial: true })).toEqual({ ok: true, cents: 5000 })
    expect(chargeAmountCents(10000, 10001, { allowPartial: true })).toEqual({ ok: false, error: 'That is more than the balance' })
    expect(chargeAmountCents(10000, 50, { allowPartial: true })).toEqual({ ok: false, error: 'Enter at least $1.00' })
    expect(chargeAmountCents(80, 80, { allowPartial: true })).toEqual({ ok: true, cents: 80 })
    expect(chargeAmountCents(0, null, { allowPartial: true })).toMatchObject({ ok: false })
    expect(chargeAmountCents(10000, 12.5, { allowPartial: true })).toMatchObject({ ok: false })
  })
  test('platform fee is off by default and capped', () => {
    expect(platformFeeBps(undefined)).toBe(0)
    expect(platformFeeBps('abc')).toBe(0)
    expect(platformFeeBps('5000')).toBe(1000)
    expect(applicationFeeCents(10000, 0)).toBe(0)
    expect(applicationFeeCents(10001, 100)).toBe(100)
  })
  test('retry days', () => {
    expect(nextRetryAt(1, { retryDays: [3, 7] }, NOW)?.toISOString()).toBe('2026-11-15T15:00:00.000Z')
    expect(nextRetryAt(2, { retryDays: [3, 7] }, NOW)?.toISOString()).toBe('2026-11-19T15:00:00.000Z')
    expect(nextRetryAt(3, { retryDays: [3, 7] }, NOW)).toBeNull()
  })
})

describe('labels', () => {
  test('charge description, payment type, card label, expiry, account status', () => {
    expect(describeCharge({ payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } } }, 'pi_1')).toEqual({ method: 'card', brand: 'visa', last4: '4242', note: 'Paid online by Visa •••• 4242 (Stripe pi_1)' })
    expect(describeCharge({ payment_method_details: { type: 'us_bank_account', us_bank_account: { last4: '6789' } } }, 'pi_2').note).toBe('Paid online by bank •••• 6789 (Stripe pi_2)')
    expect(paymentTypeForInvoice('deposit')).toBe('deposit')
    expect(paymentTypeForInvoice('service')).toBe('other')
    expect(cardLabel({ brand: 'american_express', last4: '0005' })).toBe('American express •••• 0005')
    expect(cardExpired({ exp_month: 10, exp_year: 2026 }, NOW)).toBe(true)
    expect(cardExpired({ exp_month: 11, exp_year: 2026 }, NOW)).toBe(false)
    expect(accountStatusFrom({ charges_enabled: true })).toBe('active')
    expect(accountStatusFrom({ details_submitted: true })).toBe('restricted')
    expect(accountStatusFrom({})).toBe('onboarding')
    expect(attemptLabel({ kind: 'autopay', status: 'failed', method: 'card', card_brand: 'visa', card_last4: '4242' })).toBe('Automatic payment didn’t go through (Visa •••• 4242)')
    expect(attemptLabel({ kind: 'checkout', status: 'succeeded', method: 'card', card_brand: 'visa', card_last4: '4242' })).toBe('Paid by Visa •••• 4242')
  })
})

// --------------------------------------------------------------------------------------------------------------- flows

type Row = Record<string, unknown>

function seed(extra: Partial<Record<string, Row[]>> = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const db = createFakeDb(
    {
      orgs: [
        { id: ORG, name: 'Acme Lawn', email: 'office@acme.test', timezone: 'America/Chicago', settings: { features: { onlinePayments: true } } },
        { id: OTHER, name: 'Other Co', timezone: 'America/Chicago', settings: { features: { onlinePayments: true } } },
      ],
      payment_accounts: [
        { id: 'pa1', org_id: ORG, account_id: ACCT, livemode: false, status: 'active', charges_enabled: true, payouts_enabled: true, details_submitted: true, disconnected_at: null, updated_at: NOW.toISOString() },
        { id: 'pa2', org_id: OTHER, account_id: 'acct_OTHER', livemode: false, status: 'active', charges_enabled: true, payouts_enabled: true, details_submitted: true, disconnected_at: null, updated_at: NOW.toISOString() },
      ],
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat Doe', email: 'pat@example.com' }],
      production_jobs: [{ id: 'job1', org_id: ORG, job_number: '26-0100', customer_id: 'c1', address_text: '1 Oak St', sale_amount: 100, allow_close_with_balance: false, close_balance_by: null }],
      job_invoices: [
        { id: 'inv-svc', org_id: ORG, job_id: null, customer_id: 'c1', invoice_number: 'INV-26-00001', invoice_kind: 'service', status: 'sent', total_cents: 10000, tax_cents: 0 },
        { id: 'inv-dep', org_id: ORG, job_id: 'job1', customer_id: null, invoice_number: 'INV-26-0100-1', invoice_kind: 'deposit', status: 'sent', total_cents: 5000, tax_cents: 0 },
      ],
      job_invoice_items: [],
      invoice_payments: [],
      job_payments: [],
      online_payments: [],
      payment_links: [],
      stripe_webhook_events: [],
      customer_payment_methods: [],
      stripe_customers: [],
      integration_outbox: [],
      ...extra,
    },
    {
      relations: { job_invoices: { production_jobs: { table: 'production_jobs', fk: 'job_id' } } },
      onRpc: (name, args) => rpcCalls.push({ name, args }),
      rpc: {
        record_customer_invoice_payment: (args, t) => {
          const inv = t.job_invoices.find((r) => r.id === args.p_invoice && r.org_id === args.p_org && r.job_id == null)
          if (!inv) throw Object.assign(new Error('not found'), { code: 'P0002' })
          const applied = t.invoice_payments.filter((p) => p.invoice_id === inv.id).reduce((s, p) => s + Number(p.applied_cents), 0)
          const balance = Number(inv.total_cents) - applied
          const dup = args.p_idempotency_key ? t.job_payments.find((p) => p.org_id === args.p_org && p.job_id == null && p.idempotency_key === args.p_idempotency_key) : null
          if (dup) return { payment_id: dup.id, status: inv.status, balance_cents: balance, duplicate: true }
          if (Number(args.p_amount_cents) > balance) throw Object.assign(new Error('That is more than the balance due'), { code: '22023' })
          const pay = `pay-${t.job_payments.length + 1}`
          t.job_payments.push({ id: pay, job_id: null, org_id: args.p_org, customer_id: inv.customer_id, amount_cents: args.p_amount_cents, method: args.p_method, paid_at: args.p_paid_at, note: args.p_note, idempotency_key: args.p_idempotency_key ?? null })
          t.invoice_payments.push({ id: `ip-${pay}`, invoice_id: inv.id, job_payment_id: pay, applied_cents: args.p_amount_cents })
          inv.status = balance - Number(args.p_amount_cents) <= 0 ? 'paid' : 'partially_paid'
          return { payment_id: pay, status: inv.status, balance_cents: balance - Number(args.p_amount_cents), duplicate: false }
        },
        record_customer_invoice_refund: (args, t) => {
          const inv = t.job_invoices.find((r) => r.id === args.p_invoice && r.org_id === args.p_org && r.job_id == null)
          if (!inv) throw Object.assign(new Error('not found'), { code: 'P0002' })
          const dup = t.job_payments.find((p) => p.org_id === args.p_org && p.idempotency_key === args.p_idempotency_key)
          if (dup) return { payment_id: dup.id, duplicate: true }
          const pay = `ref-${t.job_payments.length + 1}`
          t.job_payments.push({ id: pay, job_id: null, org_id: args.p_org, amount_cents: -Number(args.p_amount_cents), idempotency_key: args.p_idempotency_key })
          t.invoice_payments.push({ id: `ip-${pay}`, invoice_id: inv.id, job_payment_id: pay, applied_cents: -Number(args.p_amount_cents) })
          return { payment_id: pay, duplicate: false }
        },
      },
    }
  )
  // Postgres primary key on stripe_webhook_events.event_id (the fake only knows `id`).
  const client = db.client as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }
  const realFrom = client.from.bind(client)
  client.from = (t: string) => {
    const b = realFrom(t)
    if (t !== 'stripe_webhook_events') return b
    const insert = b.insert
    return { ...b, insert: (...a: unknown[]) => (db.tables.stripe_webhook_events.some((e) => e.event_id === (a[0] as Row).event_id) ? Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }) : insert(...a)) }
  }
  mockClient = db.client
  return { ...db, rpcCalls }
}

// ---- Stripe fixtures over fetch -----------------------------------------------------------------------------------------

type Call = { method: string; path: string; body: URLSearchParams; account: string | null; idem: string | null }
let calls: Call[] = []
let stripe: Record<string, (c: Call) => { status?: number; json: unknown }> = {}

const visaCharge = { id: 'ch_1', created: Math.floor(NOW.getTime() / 1000), payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } } }
const pi = (id: string, meta: Row, over: Row = {}) => ({ id, object: 'payment_intent', status: 'succeeded', amount: 10000, amount_received: 10000, livemode: false, created: visaCharge.created, metadata: meta, latest_charge: visaCharge, ...over })

beforeEach(() => {
  calls = []
  stripe = {}
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  delete process.env.STRIPE_APPLICATION_FEE_BPS
  delete process.env.SMTP_HOST
  global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url))
    const headers = (init?.headers ?? {}) as Record<string, string>
    const c: Call = { method: init?.method ?? 'GET', path: u.pathname, body: new URLSearchParams(init?.body ? String(init.body) : u.search.slice(1)), account: headers['Stripe-Account'] ?? null, idem: headers['Idempotency-Key'] ?? null }
    calls.push(c)
    const route = Object.keys(stripe).find((k) => `${c.method} ${c.path}`.startsWith(k))
    if (!route) return new Response(JSON.stringify({ error: { message: `no fixture for ${c.method} ${c.path}` } }), { status: 404 })
    const r = stripe[route](c)
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
})

const event = (id: string, type: string, object: Row, account: string | null = ACCT) => ({ id, type, account, livemode: false, data: { object } })

describe('pay an invoice without a job (service plan) by card', () => {
  test('pay link → Checkout on the company account → webhook records once → refund comes back off the invoice', async () => {
    const d = seed()
    const op = await loadOnlinePayments(d.client as never, ORG)
    expect(op.ready).toBe(true)

    const link = await createPaymentLink(d.client as never, ORG, { kind: 'invoice', invoiceId: 'inv-svc' }, 'u1', NOW)
    const token = link.url.split('/pay/')[1]
    expect(link.url.startsWith('https://acme.crm.test/pay/')).toBe(true)
    expect(isWellFormedLinkToken(token)).toBe(true)
    expect(d.tables.payment_links[0].token_hash).not.toContain(token) // only the hash is stored
    const row = await resolvePaymentLink(d.client as never, token, NOW)
    expect(row?.org_id).toBe(ORG)

    stripe['POST /v1/checkout/sessions'] = () => ({ json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' } })
    const out = await createInvoiceCheckout(d.client as never, op, row!, { companyName: 'Acme Lawn' }, { successUrl: 's', cancelUrl: 'c' }, NOW)
    expect(out).toEqual({ ok: true, url: 'https://checkout.stripe.com/c/cs_1' })
    const sent = calls[0]
    expect(sent.account).toBe(ACCT) // direct charge on the company's own account
    expect(sent.body.get('line_items[0][price_data][unit_amount]')).toBe('10000')
    expect(sent.body.getAll('payment_method_types[0]').concat(sent.body.getAll('payment_method_types[1]'))).toEqual(['card', 'us_bank_account'])
    expect(sent.body.get('payment_intent_data[metadata][crm_org_id]')).toBe(ORG)
    expect(sent.body.get('payment_intent_data[application_fee_amount]')).toBeNull() // platform fee off
    expect(Array.from(sent.body.keys()).some((k) => /surcharge|tip/.test(k))).toBe(false)
    expect(d.tables.online_payments[0]).toMatchObject({ status: 'open', checkout_session_id: 'cs_1', amount_cents: 10000 })

    // A part payment is refused unless the company allows it.
    const part = await createInvoiceCheckout(d.client as never, op, row!, { amountCents: 5000, companyName: 'Acme Lawn' }, { successUrl: 's', cancelUrl: 'c' }, NOW)
    expect(part).toMatchObject({ ok: false, status: 400 })

    const meta = { crm_org_id: ORG, invoice_id: 'inv-svc', online_payment_id: d.tables.online_payments[0].id, kind: 'checkout' }
    stripe['GET /v1/checkout/sessions/cs_1'] = () => ({ json: { id: 'cs_1', mode: 'payment', status: 'complete', payment_status: 'paid', metadata: meta, payment_intent: pi('pi_1', meta) } })
    const r1 = await handleStripeWebhookEvent(d.client as never, event('evt_1', 'checkout.session.completed', { id: 'cs_1', metadata: meta }), NOW)
    expect(r1.status).toBe(200)
    const payRpc = d.rpcCalls.filter((c) => c.name === 'record_customer_invoice_payment')
    expect(payRpc).toHaveLength(1)
    expect(payRpc[0].args).toMatchObject({ p_org: ORG, p_invoice: 'inv-svc', p_amount_cents: 10000, p_method: 'card', p_idempotency_key: 'stripe:pi_1', p_paid_at: '2026-11-12' })
    expect(String(payRpc[0].args.p_note)).toContain('Visa •••• 4242')
    expect(d.tables.job_invoices.find((i) => i.id === 'inv-svc')?.status).toBe('paid')
    expect(d.tables.online_payments[0]).toMatchObject({ status: 'succeeded', payment_intent_id: 'pi_1', job_payment_id: 'pay-1', method: 'card', card_last4: '4242' })

    // Same event again (Stripe retry) and another event for the same payment: nothing more is written.
    expect((await handleStripeWebhookEvent(d.client as never, event('evt_1', 'checkout.session.completed', { id: 'cs_1', metadata: meta }), NOW)).body).toMatchObject({ duplicate: true })
    stripe['GET /v1/payment_intents/pi_1'] = () => ({ json: pi('pi_1', meta) })
    await handleStripeWebhookEvent(d.client as never, event('evt_2', 'payment_intent.succeeded', { id: 'pi_1', metadata: meta }), NOW)
    expect(d.rpcCalls.filter((c) => c.name === 'record_customer_invoice_payment')).toHaveLength(1)
    expect(d.tables.job_payments).toHaveLength(1)

    // Partial refund in Stripe → one negative payment, keyed by the refund id; replays add nothing.
    stripe['GET /v1/refunds'] = () => ({ json: { data: [{ id: 're_1', amount: 3000, status: 'succeeded', created: visaCharge.created }, { id: 're_2', amount: 500, status: 'pending', created: visaCharge.created }] } })
    await handleStripeWebhookEvent(d.client as never, event('evt_3', 'charge.refunded', { id: 'ch_1', payment_intent: 'pi_1' }), NOW)
    await handleStripeWebhookEvent(d.client as never, event('evt_4', 'charge.refund.updated', { id: 're_1', payment_intent: 'pi_1' }), NOW)
    const refunds = d.rpcCalls.filter((c) => c.name === 'record_customer_invoice_refund')
    expect(refunds.map((r) => r.args.p_idempotency_key)).toEqual(['stripe-refund:re_1', 'stripe-refund:re_1'])
    expect(d.tables.job_payments.filter((p) => Number(p.amount_cents) < 0)).toHaveLength(1)
    expect(d.tables.invoice_payments.reduce((s, p) => s + Number(p.applied_cents), 0)).toBe(7000)
    expect(d.tables.online_payments[0].refunded_cents).toBe(3000)
  })

  test('a bank payment that is clearing blocks a second payment of the same balance', async () => {
    const d = seed()
    const op = await loadOnlinePayments(d.client as never, ORG)
    const link = await createPaymentLink(d.client as never, ORG, { kind: 'invoice', invoiceId: 'inv-svc' }, null, NOW)
    const row = await resolvePaymentLink(d.client as never, link.url.split('/pay/')[1], NOW)
    stripe['POST /v1/checkout/sessions'] = () => ({ json: { id: 'cs_ach', url: 'https://checkout.stripe.com/c/cs_ach' } })
    await createInvoiceCheckout(d.client as never, op, row!, { companyName: 'Acme' }, { successUrl: 's', cancelUrl: 'c' }, NOW)
    const meta = { crm_org_id: ORG, invoice_id: 'inv-svc', online_payment_id: d.tables.online_payments[0].id }
    const bank = { id: 'ch_b', created: visaCharge.created, payment_method_details: { type: 'us_bank_account', us_bank_account: { last4: '6789' } } }
    stripe['GET /v1/checkout/sessions/cs_ach'] = () => ({ json: { id: 'cs_ach', mode: 'payment', status: 'complete', payment_status: 'unpaid', metadata: meta, payment_intent: pi('pi_ach', meta, { status: 'processing', amount_received: 0, latest_charge: bank }) } })
    await handleStripeWebhookEvent(d.client as never, event('evt_ach', 'checkout.session.completed', { id: 'cs_ach', metadata: meta }), NOW)
    expect(d.tables.online_payments[0]).toMatchObject({ status: 'processing', method: 'ach' })
    expect(d.tables.job_payments).toHaveLength(0) // nothing is recorded until the bank says it cleared
    const again = await createInvoiceCheckout(d.client as never, op, row!, { companyName: 'Acme' }, { successUrl: 's', cancelUrl: 'c' }, NOW)
    expect(again).toEqual({ ok: false, status: 409, error: 'A bank payment for this invoice is already on its way' })

    // It bounces: the invoice stays open, the attempt reads failed.
    stripe['GET /v1/payment_intents/pi_ach'] = () => ({ json: pi('pi_ach', meta, { status: 'requires_payment_method', amount_received: 0, last_payment_error: { code: 'insufficient_funds', message: 'Insufficient funds' } }) })
    await handleStripeWebhookEvent(d.client as never, event('evt_ach2', 'payment_intent.payment_failed', { id: 'pi_ach', metadata: meta }), NOW)
    expect(d.tables.online_payments[0]).toMatchObject({ status: 'failed', failure_code: 'insufficient_funds' })
    expect(d.tables.job_invoices.find((i) => i.id === 'inv-svc')?.status).toBe('sent')
  })
})

describe('deposit on a job invoice', () => {
  test('goes through the one job payment writer (job payment + outbox) and onto the invoice', async () => {
    const d = seed()
    const meta = { crm_org_id: ORG, invoice_id: 'inv-dep', kind: 'checkout' }
    stripe['GET /v1/payment_intents/pi_dep'] = () => ({ json: pi('pi_dep', meta, { amount: 5000, amount_received: 5000 }) })
    const r = await handleStripeWebhookEvent(d.client as never, event('evt_dep', 'payment_intent.succeeded', { id: 'pi_dep', metadata: meta }), NOW)
    expect(r.status).toBe(200)
    expect(d.tables.job_payments).toEqual([
      expect.objectContaining({ job_id: 'job1', amount_cents: 5000, payment_type: 'deposit', method: 'card', payer: 'homeowner', idempotency_key: 'stripe:pi_dep', created_by: null }),
    ])
    expect(d.tables.integration_outbox).toEqual([expect.objectContaining({ event_type: 'payment.recorded', entity_id: d.tables.job_payments[0].id })])
    expect(d.tables.invoice_payments).toEqual([expect.objectContaining({ invoice_id: 'inv-dep', applied_cents: 5000 })])
    expect(d.tables.job_invoices.find((i) => i.id === 'inv-dep')?.status).toBe('paid')

    // Refunded in full: a negative job payment and a negative application re-open the invoice; nothing is deleted.
    stripe['GET /v1/refunds'] = () => ({ json: { data: [{ id: 're_dep', amount: 5000, status: 'succeeded', created: visaCharge.created }] } })
    await handleStripeWebhookEvent(d.client as never, event('evt_dep_r', 'charge.refunded', { id: 'ch_1', payment_intent: 'pi_dep' }), NOW)
    expect(d.tables.job_payments.map((p) => p.amount_cents)).toEqual([5000, -5000])
    expect(d.tables.invoice_payments.map((p) => p.applied_cents)).toEqual([5000, -5000])
    expect(d.tables.job_invoices.find((i) => i.id === 'inv-dep')?.status).toBe('sent')
  })

  test('money that can no longer go on its invoice is kept and flagged, never lost', async () => {
    const d = seed()
    d.tables.invoice_payments.push({ id: 'cash', invoice_id: 'inv-dep', job_payment_id: 'jp-cash', applied_cents: 5000 })
    const meta = { crm_org_id: ORG, invoice_id: 'inv-dep' }
    stripe['GET /v1/payment_intents/pi_late'] = () => ({ json: pi('pi_late', meta, { amount: 5000, amount_received: 5000 }) })
    await handleStripeWebhookEvent(d.client as never, event('evt_late', 'payment_intent.succeeded', { id: 'pi_late', metadata: meta }), NOW)
    expect(d.tables.job_payments).toHaveLength(1) // counts on the job
    expect(d.tables.online_payments[0]).toMatchObject({ status: 'needs_review', job_payment_id: d.tables.job_payments[0].id })
  })
})

describe('one company, one account', () => {
  test("an event from company A's account naming company B is ignored", async () => {
    const d = seed()
    const meta = { crm_org_id: OTHER, invoice_id: 'inv-svc' }
    stripe['GET /v1/payment_intents/pi_x'] = () => ({ json: pi('pi_x', meta) })
    await handleStripeWebhookEvent(d.client as never, event('evt_x', 'payment_intent.succeeded', { id: 'pi_x', metadata: { crm_org_id: ORG } }), NOW)
    expect(d.tables.job_payments).toHaveLength(0)
    expect(d.rpcCalls).toHaveLength(0)
  })
  test("company B's account cannot pay company A's invoice", async () => {
    const d = seed()
    const meta = { crm_org_id: OTHER, invoice_id: 'inv-svc' }
    stripe['GET /v1/payment_intents/pi_y'] = () => ({ json: pi('pi_y', meta) })
    await handleStripeWebhookEvent(d.client as never, event('evt_y', 'payment_intent.succeeded', { id: 'pi_y', metadata: { crm_org_id: OTHER } }, 'acct_OTHER'), NOW)
    expect(d.tables.job_payments).toHaveLength(0)
    expect(d.rpcCalls).toHaveLength(0)
  })
  test("the company's other Stripe sales (no CRM metadata) are skipped without reading Stripe", async () => {
    const d = seed()
    expect((await handleStripeWebhookEvent(d.client as never, event('evt_shop', 'payment_intent.succeeded', { id: 'pi_shop', metadata: {} }), NOW)).body).toMatchObject({ ignored: true })
    expect(calls).toHaveLength(0)
  })
  test('unknown accounts and platform events are acknowledged and ignored', async () => {
    const d = seed()
    expect((await handleStripeWebhookEvent(d.client as never, event('evt_u', 'payment_intent.succeeded', { id: 'pi_1' }, 'acct_NOBODY'), NOW)).body).toMatchObject({ ignored: true })
    expect((await handleStripeWebhookEvent(d.client as never, event('evt_p', 'payment_intent.succeeded', { id: 'pi_1' }, null), NOW)).body).toMatchObject({ ignored: true })
    expect(calls).toHaveLength(0)
  })
  test('the company disconnecting in Stripe marks the account disconnected', async () => {
    const d = seed()
    await handleStripeWebhookEvent(d.client as never, event('evt_d', 'account.application.deauthorized', { id: 'ca_1' }), NOW)
    expect(d.tables.payment_accounts[0].status).toBe('disconnected')
    expect((await loadOnlinePayments(d.client as never, ORG)).ready).toBe(false)
  })
})

describe('webhook route', () => {
  test('refuses a missing / bad signature and needs the secret', async () => {
    seed()
    const body = JSON.stringify(event('evt_r', 'payment_intent.succeeded', { id: 'pi_1' }))
    delete process.env.STRIPE_WEBHOOK_SECRET
    expect((await webhookPOST(new Request('https://x/api/webhooks/stripe', { method: 'POST', body }))).status).toBe(503)
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_route'
    expect((await webhookPOST(new Request('https://x/api/webhooks/stripe', { method: 'POST', body }))).status).toBe(400)
    const bad = `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`
    expect((await webhookPOST(new Request('https://x/api/webhooks/stripe', { method: 'POST', body, headers: { 'stripe-signature': bad } }))).status).toBe(400)
    const t = Math.floor(Date.now() / 1000)
    const good = `t=${t},v1=${createHmac('sha256', 'whsec_route').update(`${t}.${body}`).digest('hex')}`
    stripe['GET /v1/payment_intents/pi_1'] = () => ({ json: pi('pi_1', { crm_org_id: OTHER }) })
    expect((await webhookPOST(new Request('https://x/api/webhooks/stripe', { method: 'POST', body, headers: { 'stripe-signature': good } }))).status).toBe(200)
  })
})

describe('autopay for service invoices', () => {
  const card = { id: 'pm-row', org_id: ORG, customer_id: 'c1', account_id: ACCT, stripe_customer_id: 'cus_1', payment_method_id: 'pm_1', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, autopay: true, consent_at: NOW.toISOString(), removed_at: null }

  test('charges the card on file off-session, once per attempt, and records it', async () => {
    const d = seed({ customer_payment_methods: [card] })
    const op = await loadOnlinePayments(d.client as never, ORG)
    stripe['POST /v1/payment_intents'] = (c) => ({ json: pi('pi_auto', { crm_org_id: ORG, invoice_id: 'inv-svc', kind: 'autopay', online_payment_id: c.body.get('metadata[online_payment_id]') }) })
    const out = await chargeInvoiceAutopay(d.client as never, op, ORG, 'inv-svc', null, NOW)
    expect(out).toEqual({ charged: true, outcome: 'recorded' })
    expect(calls[0]).toMatchObject({ account: ACCT, idem: 'autopay:inv-svc:1' })
    expect(calls[0].body.get('off_session')).toBe('true')
    expect(calls[0].body.get('confirm')).toBe('true')
    expect(calls[0].body.get('payment_method')).toBe('pm_1')
    expect(d.tables.job_invoices.find((i) => i.id === 'inv-svc')?.status).toBe('paid')
    // Paid: nothing left to charge.
    expect(await chargeInvoiceAutopay(d.client as never, op, ORG, 'inv-svc', null, NOW)).toMatchObject({ charged: false })
  })

  test('a decline leaves the invoice open, schedules the retry, and the retry is attempt 2', async () => {
    const d = seed({ customer_payment_methods: [card] })
    const op = await loadOnlinePayments(d.client as never, ORG)
    stripe['POST /v1/payment_intents'] = () => ({ status: 402, json: { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.', payment_intent: { id: 'pi_dec' } } } })
    const out = await chargeInvoiceAutopay(d.client as never, op, ORG, 'inv-svc', null, NOW)
    expect(out).toEqual({ charged: true, outcome: 'failed' })
    expect(d.tables.online_payments[0]).toMatchObject({ kind: 'autopay', status: 'failed', attempt: 1, failure_code: 'insufficient_funds', payment_intent_id: 'pi_dec', next_retry_at: '2026-11-15T15:00:00.000Z' })
    expect(d.tables.job_invoices.find((i) => i.id === 'inv-svc')?.status).toBe('sent')

    expect(await runAutopayRetries(d.client as never, ORG, NOW)).toEqual({ tried: 0 }) // not due yet
    stripe['POST /v1/payment_intents'] = (c) => ({ json: pi('pi_retry', { crm_org_id: ORG, invoice_id: 'inv-svc', kind: 'autopay', online_payment_id: c.body.get('metadata[online_payment_id]') }) })
    const later = new Date('2026-11-15T16:00:00Z')
    expect(await runAutopayRetries(d.client as never, ORG, later)).toEqual({ tried: 1 })
    expect(calls[calls.length - 1].idem).toBe('autopay:inv-svc:2')
    expect(d.tables.job_invoices.find((i) => i.id === 'inv-svc')?.status).toBe('paid')
    expect(await runAutopayRetries(d.client as never, ORG, new Date('2026-11-30T16:00:00Z'))).toEqual({ tried: 0 })
  })

  test('no card, autopay off, expired card or a job invoice → no charge', async () => {
    const d = seed({ customer_payment_methods: [{ ...card, exp_year: 2025 }] })
    const op = await loadOnlinePayments(d.client as never, ORG)
    expect(await chargeInvoiceAutopay(d.client as never, op, ORG, 'inv-svc', null, NOW)).toEqual({ charged: false, reason: 'card expired' })
    expect(await chargeInvoiceAutopay(d.client as never, op, ORG, 'inv-dep', null, NOW)).toEqual({ charged: false, reason: 'not a service invoice' })
    expect(await chargeInvoiceAutopay(d.client as never, { ...op, settings: { ...op.settings, autopay: false } }, ORG, 'inv-svc', null, NOW)).toEqual({ charged: false, reason: 'off' })
    expect(calls).toHaveLength(0)
  })
})
