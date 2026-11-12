/**
 * The company's own Stripe account (Stripe Connect, direct charges). ONE module for: connect (Connect onboarding link),
 * status, disconnect, settings, and "can this company take a payment right now" (`loadOnlinePayments`).
 *
 * Accounts are created with Accounts v1 controller properties that match a Standard account — the company pays Stripe's
 * fees, Stripe carries negative-balance risk, Stripe collects requirements, full Stripe Dashboard
 * (https://docs.stripe.com/connect/migrate-to-controller-properties). Onboarding is an Account Link
 * (https://docs.stripe.com/connect/standard-accounts) — Stripe recommends that over OAuth for platforms; OAuth is kept
 * for extensions (https://docs.stripe.com/connect/oauth-standard-accounts), so there is no STRIPE_CONNECT_CLIENT_ID.
 *
 * Disconnect never touches the company's Stripe account (it is theirs): the CRM stops taking payments and keeps the row,
 * so refunds and late webhooks still find the company. Connecting again resumes the same account unless Stripe says the
 * platform lost access (they removed us), in which case a new account is started.
 */
import { isDemoOrg } from '@/lib/demo-org'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgFeatures } from '@/lib/org-features'
import { mergeOrgSettings } from '@/lib/org-settings'
import { orgDb } from '@/lib/supabase/org-db'
import { StripeApiError, stripeConfigured, stripeKeyIsLive, stripeRequest, type StripeObject } from '@/lib/stripe/api'
import {
  ONLINE_PAYMENTS_SETTINGS_KEY,
  readOnlinePaymentSettings,
  type OnlinePaymentSettings,
} from '@/lib/online-payments/settings'

export type PaymentAccountStatus = 'onboarding' | 'active' | 'restricted' | 'disconnected'

export type PaymentAccountRow = {
  id: string
  org_id: string
  account_id: string
  livemode: boolean
  status: PaymentAccountStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  disconnected_at: string | null
  updated_at: string
}

const ACCOUNT_COLS = 'id, org_id, account_id, livemode, status, charges_enabled, payouts_enabled, details_submitted, disconnected_at, updated_at'

/** Pure: Stripe account flags → our status. */
export function accountStatusFrom(a: { charges_enabled?: boolean; details_submitted?: boolean }): PaymentAccountStatus {
  if (a.charges_enabled) return 'active'
  return a.details_submitted ? 'restricted' : 'onboarding'
}

/** The company's live (not disconnected) account row, or null. */
export async function loadLiveAccount(admin: SupabaseClient, orgId: string): Promise<PaymentAccountRow | null> {
  const { data } = await orgDb(admin, orgId)
    .from('payment_accounts')
    .select(ACCOUNT_COLS)
    .neq('status', 'disconnected')
    .maybeSingle()
  return (data as PaymentAccountRow | null) ?? null
}

/** Webhooks: which company owns this connected account (any status — refunds can arrive after a disconnect). */
export async function findAccountByStripeId(admin: SupabaseClient, accountId: string): Promise<PaymentAccountRow | null> {
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) return null
  // org-scope-ok: the connected account id is the key that RESOLVES the company (unique; set only by our own connect flow)
  const { data } = await admin.from('payment_accounts').select(ACCOUNT_COLS).eq('account_id', accountId).maybeSingle()
  return (data as PaymentAccountRow | null) ?? null
}

export type OnlinePayments = {
  featureOn: boolean
  configured: boolean
  settings: OnlinePaymentSettings
  account: PaymentAccountRow | null
  /** Switch on + keys set + account can take charges, in the same mode as our key. */
  ready: boolean
}

export async function loadOnlinePayments(admin: SupabaseClient, orgId: string): Promise<OnlinePayments> {
  const [features, { data: org }, account] = await Promise.all([
    loadOrgFeatures(admin, orgId),
    admin.from('orgs').select('online:settings->onlinePayments').eq('id', orgId).maybeSingle(),
    loadLiveAccount(admin, orgId).catch(() => null),
  ])
  const settings = readOnlinePaymentSettings((org as { online?: unknown } | null)?.online ?? {})
  // A demo company never charges through a LIVE key (lib/demo-org.ts): test keys only.
  const configured = stripeConfigured() && !(stripeKeyIsLive() && (await isDemoOrg(admin, orgId)))
  const ready =
    features.onlinePayments && configured && !!account && account.status === 'active' && account.charges_enabled && account.livemode === stripeKeyIsLive()
  return { featureOn: features.onlinePayments, configured, settings, account, ready }
}

async function syncAccountRow(admin: SupabaseClient, row: PaymentAccountRow, a: StripeObject): Promise<PaymentAccountRow> {
  const patch = {
    charges_enabled: !!a.charges_enabled,
    payouts_enabled: !!a.payouts_enabled,
    details_submitted: !!a.details_submitted,
    status: row.status === 'disconnected' ? 'disconnected' : accountStatusFrom(a),
    updated_at: new Date().toISOString(),
  }
  const { data } = await orgDb(admin, row.org_id).from('payment_accounts').update(patch).eq('id', row.id).select(ACCOUNT_COLS).maybeSingle()
  return (data as PaymentAccountRow | null) ?? { ...row, ...patch } as PaymentAccountRow
}

/** Re-read the account from Stripe (Settings card load, return from onboarding, `account.updated`). */
export async function refreshAccount(admin: SupabaseClient, row: PaymentAccountRow): Promise<PaymentAccountRow> {
  const a = await stripeRequest('GET', `/v1/accounts/${encodeURIComponent(row.account_id)}`)
  return syncAccountRow(admin, row, a)
}

/** `account.updated` webhook: the event carries the whole account object. */
export async function applyAccountUpdate(admin: SupabaseClient, row: PaymentAccountRow, a: StripeObject): Promise<void> {
  await syncAccountRow(admin, row, a)
}

/** Stripe no longer lets us reach the account (they disconnected the platform in their dashboard). */
export async function markAccountDisconnected(
  admin: SupabaseClient,
  row: Pick<PaymentAccountRow, 'id' | 'org_id'>,
  reason: string,
  by: string | null = null
): Promise<void> {
  await orgDb(admin, row.org_id)
    .from('payment_accounts')
    .update({ status: 'disconnected', disconnected_at: new Date().toISOString(), disconnected_by: by, disconnect_reason: reason.slice(0, 200), updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .neq('status', 'disconnected')
}

function lostAccess(e: unknown): boolean {
  return e instanceof StripeApiError && (e.status === 403 || e.code === 'account_invalid' || (e.status === 404 && /account/i.test(e.message)))
}

/**
 * Start or continue onboarding: returns Stripe's one-time onboarding URL (redirect the signed-in owner to it; never email
 * it — Stripe's rule). Creates the account the first time (business name/email/website prefilled from the company).
 */
export async function startOnboarding(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  urls: { returnUrl: string; refreshUrl: string }
): Promise<{ url: string }> {
  let row = await loadLiveAccount(admin, orgId)
  if (row) {
    try {
      row = await refreshAccount(admin, row)
    } catch (e) {
      if (!lostAccess(e)) throw e
      await markAccountDisconnected(admin, row, 'Stripe no longer gives the platform access to this account')
      row = null
    }
  }
  if (!row) row = await reuseDisconnectedAccount(admin, orgId, userId)
  if (!row) {
    const { count: before } = await orgDb(admin, orgId).from('payment_accounts').select('id', { count: 'exact', head: true })
    const { data: org } = await admin.from('orgs').select('name, email, settings').eq('id', orgId).maybeSingle()
    const o = (org ?? {}) as { name?: string | null; email?: string | null; settings?: { brand?: { website?: string } } | null }
    const website = typeof o.settings?.brand?.website === 'string' && /^https:\/\//.test(o.settings.brand.website) ? o.settings.brand.website : undefined
    const created = await stripeRequest(
      'POST',
      '/v1/accounts',
      {
        country: 'US',
        email: o.email || undefined,
        business_profile: { name: o.name || undefined, url: website },
        controller: {
          fees: { payer: 'account' },
          losses: { payments: 'stripe' },
          requirement_collection: 'stripe',
          stripe_dashboard: { type: 'full' },
        },
        metadata: { crm_org_id: orgId },
      },
      // One account per company even if the owner double-taps Connect (a later reconnect is a new attempt number).
      { idempotencyKey: `connect-account:${orgId}:${before ?? 0}` }
    )
    const { data, error } = await orgDb(admin, orgId)
      .from('payment_accounts')
      .insert({
        account_id: String(created.id),
        livemode: !!created.livemode || stripeKeyIsLive(),
        status: accountStatusFrom(created),
        charges_enabled: !!created.charges_enabled,
        payouts_enabled: !!created.payouts_enabled,
        details_submitted: !!created.details_submitted,
        connected_by: userId,
      })
      .select(ACCOUNT_COLS)
      .single()
    if (error) {
      // A second tap raced us: use the row that won.
      row = await loadLiveAccount(admin, orgId)
      if (!row) throw new Error(`Could not save the Stripe account: ${error.message}`)
    } else {
      row = data as PaymentAccountRow
    }
  }
  const link = await stripeRequest('POST', '/v1/account_links', {
    account: row.account_id,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: 'account_onboarding',
  })
  if (typeof link.url !== 'string') throw new Error('Stripe did not return an onboarding link')
  return { url: link.url }
}

/** The company disconnected in the CRM earlier and Stripe still lets us in: bring that same account back. */
async function reuseDisconnectedAccount(admin: SupabaseClient, orgId: string, userId: string): Promise<PaymentAccountRow | null> {
  const { data } = await orgDb(admin, orgId)
    .from('payment_accounts')
    .select(ACCOUNT_COLS)
    .eq('status', 'disconnected')
    .order('updated_at', { ascending: false })
    .limit(1)
  const old = ((data ?? []) as PaymentAccountRow[])[0]
  if (!old || old.livemode !== stripeKeyIsLive()) return null
  let a: StripeObject
  try {
    a = await stripeRequest('GET', `/v1/accounts/${encodeURIComponent(old.account_id)}`)
  } catch (e) {
    if (lostAccess(e)) return null
    throw e
  }
  const { data: back } = await orgDb(admin, orgId)
    .from('payment_accounts')
    .update({
      status: accountStatusFrom(a),
      charges_enabled: !!a.charges_enabled,
      payouts_enabled: !!a.payouts_enabled,
      details_submitted: !!a.details_submitted,
      disconnected_at: null,
      disconnected_by: null,
      disconnect_reason: null,
      connected_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', old.id)
    .select(ACCOUNT_COLS)
    .maybeSingle()
  return (back as PaymentAccountRow | null) ?? null
}

export async function saveOnlinePaymentSettings(admin: SupabaseClient, orgId: string, set: Partial<OnlinePaymentSettings>): Promise<{ error: string | null }> {
  return mergeOrgSettings(admin, orgId, set as Record<string, unknown>, { path: [ONLINE_PAYMENTS_SETTINGS_KEY] })
}

/** What the Settings card shows (no secrets, no Stripe ids beyond the account's own). */
export function publicAccountView(a: OnlinePayments) {
  return {
    featureOn: a.featureOn,
    configured: a.configured,
    ready: a.ready,
    settings: a.settings,
    testMode: !stripeKeyIsLive(),
    account: a.account
      ? {
          status: a.account.status,
          chargesEnabled: a.account.charges_enabled,
          payoutsEnabled: a.account.payouts_enabled,
          detailsSubmitted: a.account.details_submitted,
          livemode: a.account.livemode,
          accountId: a.account.account_id,
        }
      : null,
  }
}
