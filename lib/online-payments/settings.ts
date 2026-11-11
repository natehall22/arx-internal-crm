/**
 * Online payments — the company's choices (pure, client-safe). Stored at `orgs.settings.onlinePayments`, written ONLY by
 * `saveOnlinePaymentSettings` (lib/online-payments/accounts.ts, owners) through mergeOrgSettings path ['onlinePayments'].
 * Nothing stored = the defaults below. Card surcharges are never added (the company pays its own Stripe fees).
 */

export const ONLINE_PAYMENTS_SETTINGS_KEY = 'onlinePayments'

export type OnlinePaymentSettings = {
  /** Customer may pay less than the balance (e.g. half now). Off = the pay page charges the balance. */
  allowPartial: boolean
  /** Bank (ACH) as well as card on the pay page. Needs ACH turned on in the company's Stripe account. */
  bankPayments: boolean
  /** Customers can save a card and invoices without a job (service plans) charge it automatically on send. */
  autopay: boolean
  /** After a failed automatic charge, try again this many days after each failure (max 3 retries). */
  retryDays: number[]
}

export const DEFAULT_ONLINE_PAYMENT_SETTINGS: Readonly<OnlinePaymentSettings> = Object.freeze({
  allowPartial: false,
  bankPayments: true,
  autopay: true,
  retryDays: [3, 7],
})

/** Smallest partial payment (Stripe's own card minimum is $0.50; $1 keeps typos out). */
export const MIN_PARTIAL_CENTS = 100
export const MAX_RETRIES = 3

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function cleanRetryDays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null
  const days = v.map((d) => Number(d))
  if (days.length > MAX_RETRIES || days.some((d) => !Number.isInteger(d) || d < 1 || d > 30)) return null
  return days
}

/** Pure: stored (whole settings or the key itself) → full settings, unknown/invalid values at their default. */
export function readOnlinePaymentSettings(stored: unknown): OnlinePaymentSettings {
  const whole = obj(stored)
  const s = ONLINE_PAYMENTS_SETTINGS_KEY in whole ? obj(whole[ONLINE_PAYMENTS_SETTINGS_KEY]) : whole
  const d = DEFAULT_ONLINE_PAYMENT_SETTINGS
  return {
    allowPartial: typeof s.allowPartial === 'boolean' ? s.allowPartial : d.allowPartial,
    bankPayments: typeof s.bankPayments === 'boolean' ? s.bankPayments : d.bankPayments,
    autopay: typeof s.autopay === 'boolean' ? s.autopay : d.autopay,
    retryDays: cleanRetryDays(s.retryDays) ?? [...d.retryDays],
  }
}

/** A save from Settings: only known keys, each validated. */
export function parseOnlinePaymentSettingsPatch(body: unknown): { set: Partial<OnlinePaymentSettings> } | { error: string } {
  const p = obj(obj(body).settings)
  const set: Partial<OnlinePaymentSettings> = {}
  for (const [k, v] of Object.entries(p)) {
    if (k === 'allowPartial' || k === 'bankPayments' || k === 'autopay') {
      if (typeof v !== 'boolean') return { error: `${k} must be on or off` }
      set[k] = v
    } else if (k === 'retryDays') {
      const days = cleanRetryDays(v)
      if (!days) return { error: `Retries: up to ${MAX_RETRIES}, each 1–30 days` }
      set.retryDays = days
    } else {
      return { error: `Unknown setting: ${k}` }
    }
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

/**
 * Pure: what the pay page may charge. Without partials it is the whole balance. With partials: $1 … balance (a balance
 * under $1 can only be paid in full). Integer cents only.
 */
export function chargeAmountCents(
  balanceCents: number,
  requestedCents: number | null | undefined,
  s: Pick<OnlinePaymentSettings, 'allowPartial'>
): { ok: true; cents: number } | { ok: false; error: string } {
  if (!Number.isInteger(balanceCents) || balanceCents <= 0) return { ok: false, error: 'Nothing is owed on this invoice' }
  if (requestedCents == null || requestedCents === balanceCents) return { ok: true, cents: balanceCents }
  if (!s.allowPartial) return { ok: false, error: 'This invoice is paid in full online' }
  if (!Number.isInteger(requestedCents)) return { ok: false, error: 'Enter an amount in dollars and cents' }
  if (requestedCents > balanceCents) return { ok: false, error: 'That is more than the balance' }
  if (requestedCents < Math.min(MIN_PARTIAL_CENTS, balanceCents)) return { ok: false, error: 'Enter at least $1.00' }
  return { ok: true, cents: requestedCents }
}

/**
 * Optional platform fee on each online payment, in basis points (env STRIPE_APPLICATION_FEE_BPS, default 0 = off, max
 * 10%). It is the platform's choice, not the company's, so it is not a company setting. 0 → no fee is sent to Stripe.
 */
export function platformFeeBps(env: string | undefined = process.env.STRIPE_APPLICATION_FEE_BPS): number {
  const n = Number(env)
  return Number.isInteger(n) && n > 0 ? Math.min(n, 1000) : 0
}

export function applicationFeeCents(amountCents: number, bps: number = platformFeeBps()): number {
  if (bps <= 0 || amountCents <= 0) return 0
  return Math.floor((amountCents * bps) / 10000)
}

/** Next automatic retry after failure number `attempt` (1-based), or null when retries are used up. */
export function nextRetryAt(attempt: number, s: Pick<OnlinePaymentSettings, 'retryDays'>, now: Date): Date | null {
  const days = s.retryDays[attempt - 1]
  if (!days) return null
  return new Date(now.getTime() + days * 86_400_000)
}

/** The words the customer agrees to when saving a card (stored with the card; shown on the pay page). */
export function autopayConsentText(companyName: string): string {
  const who = companyName.trim() || 'the company'
  return `I authorize ${who} to charge this card for my service invoices when they are sent, until I ask them to stop.`
}
