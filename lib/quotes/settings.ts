/**
 * Quote approval — the company's choices (pure, client-safe). Stored at `orgs.settings.quoteApproval`, written ONLY by
 * `saveQuoteApprovalSettings` (lib/quotes/settings-server.ts, owners) through mergeOrgSettings path ['quoteApproval'].
 * Nothing stored = the defaults below (no deposit, 30-day links, no extra terms).
 */
export const QUOTE_APPROVAL_SETTINGS_KEY = 'quoteApproval'

export type DepositMode = 'none' | 'percent' | 'fixed'

export type QuoteApprovalSettings = {
  /** Deposit asked when a quote does not set its own. */
  depositMode: DepositMode
  /** Percent of the approved total (0–100), used when depositMode = 'percent'. */
  depositPercent: number
  /** Fixed deposit in cents, used when depositMode = 'fixed'. */
  depositFixedCents: number
  /** Days a quote link works after it is sent. */
  linkDays: number
  /** Terms the customer agrees to by approving (used when the quote has none of its own). */
  terms: string
}

export const DEFAULT_QUOTE_APPROVAL_SETTINGS: Readonly<QuoteApprovalSettings> = Object.freeze({
  depositMode: 'none',
  depositPercent: 0,
  depositFixedCents: 0,
  linkDays: 30,
  terms: '',
})

export const MAX_TERMS_LENGTH = 4000
export const LINK_DAYS_RANGE = { min: 1, max: 120 }

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function isDepositMode(v: unknown): v is DepositMode {
  return v === 'none' || v === 'percent' || v === 'fixed'
}

/** Pure: stored (whole settings or the key itself) → full settings; anything invalid reads as its default. */
export function readQuoteApprovalSettings(stored: unknown): QuoteApprovalSettings {
  const whole = obj(stored)
  const s = QUOTE_APPROVAL_SETTINGS_KEY in whole ? obj(whole[QUOTE_APPROVAL_SETTINGS_KEY]) : whole
  const d = DEFAULT_QUOTE_APPROVAL_SETTINGS
  const pct = Number(s.depositPercent)
  const fixed = Number(s.depositFixedCents)
  const days = Number(s.linkDays)
  return {
    depositMode: isDepositMode(s.depositMode) ? s.depositMode : d.depositMode,
    depositPercent: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct * 100) / 100 : d.depositPercent,
    depositFixedCents: Number.isInteger(fixed) && fixed >= 0 ? fixed : d.depositFixedCents,
    linkDays: Number.isInteger(days) && days >= LINK_DAYS_RANGE.min && days <= LINK_DAYS_RANGE.max ? days : d.linkDays,
    terms: typeof s.terms === 'string' ? s.terms.slice(0, MAX_TERMS_LENGTH) : d.terms,
  }
}

/** A save from Settings: only known keys, each validated. */
export function parseQuoteApprovalPatch(body: unknown): { set: Partial<QuoteApprovalSettings> } | { error: string } {
  const p = obj(obj(body).settings)
  const set: Partial<QuoteApprovalSettings> = {}
  for (const [k, v] of Object.entries(p)) {
    if (k === 'depositMode') {
      if (!isDepositMode(v)) return { error: 'Deposit must be none, a percent or a fixed amount' }
      set.depositMode = v
    } else if (k === 'depositPercent') {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0 || n > 100) return { error: 'Deposit percent must be between 0 and 100' }
      set.depositPercent = Math.round(n * 100) / 100
    } else if (k === 'depositFixedCents') {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) return { error: 'Enter the deposit in dollars and cents' }
      set.depositFixedCents = n
    } else if (k === 'linkDays') {
      const n = Number(v)
      if (!Number.isInteger(n) || n < LINK_DAYS_RANGE.min || n > LINK_DAYS_RANGE.max) return { error: `Links last ${LINK_DAYS_RANGE.min}–${LINK_DAYS_RANGE.max} days` }
      set.linkDays = n
    } else if (k === 'terms') {
      if (typeof v !== 'string' || v.length > MAX_TERMS_LENGTH) return { error: `Terms can be up to ${MAX_TERMS_LENGTH} characters` }
      set.terms = v.trim()
    } else {
      return { error: `Unknown setting: ${k}` }
    }
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

/** What a quote asks as a deposit: its own override (`proposals.deposit_mode/value`), else the company default. */
export function effectiveDeposit(
  quote: { deposit_mode?: string | null; deposit_value?: number | string | null },
  company: Pick<QuoteApprovalSettings, 'depositMode' | 'depositPercent' | 'depositFixedCents'>
): { mode: DepositMode; percent: number; fixedCents: number; overridden: boolean } {
  if (isDepositMode(quote.deposit_mode)) {
    const v = Number(quote.deposit_value)
    const value = Number.isFinite(v) && v >= 0 ? v : 0
    return {
      mode: quote.deposit_mode,
      percent: quote.deposit_mode === 'percent' ? Math.min(100, value) : 0,
      fixedCents: quote.deposit_mode === 'fixed' ? Math.round(value * 100) : 0,
      overridden: true,
    }
  }
  return { mode: company.depositMode, percent: company.depositPercent, fixedCents: company.depositFixedCents, overridden: false }
}

/** The deposit in cents for an approved total. Never more than the total; 0 = none. Percent rounds half-up to the cent. */
export function depositCents(totalCents: number, d: { mode: DepositMode; percent: number; fixedCents: number }): number {
  if (!Number.isInteger(totalCents) || totalCents <= 0 || d.mode === 'none') return 0
  const raw = d.mode === 'percent' ? Math.round(totalCents * (d.percent / 100)) : d.fixedCents
  return Math.min(Math.max(0, Math.round(raw)), totalCents)
}
