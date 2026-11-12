/**
 * Signing — the company's choices (pure, client-safe). Stored at `orgs.settings.signing`, written ONLY by
 * `saveSigningSettings` (lib/signing/settings-server.ts, owners) through mergeOrgSettings path ['signing'].
 *
 * DEFAULTS (Nathan, 2026-11-11: today's signing keeps working exactly as is; new capabilities are switches):
 *  - a company with NO industry profile saved is the original company: every new capability that a customer or the
 *    office can see (consent step, decline button, filing on the customer) is OFF until an owner turns it on;
 *  - a company that has a profile (a company set up for the multi-company product) gets consent + decline + filing ON;
 *  - the lifecycle EMAILS (automatic reminders, the signed copy + certificate to the rep and company, the certificate
 *    on the customer's copy, a decline notice) are OFF for everyone until an owner turns them on.
 * The evidence record (events, SHA-256, certificate file) is invisible and always kept.
 */
import type { SigningProviderId } from '@/lib/signing/types'
import { SIGNING_PROVIDER_IDS } from '@/lib/signing/types'

export const SIGNING_SETTINGS_KEY = 'signing'

export type SigningSettings = {
  provider: SigningProviderId
  /** Show the ESIGN disclosure + "I agree to sign electronically" before signing; the server refuses a signature without it. */
  consentStep: boolean
  /** Show "I can't sign this" on the signing page (the signer gives a reason). */
  declineEnabled: boolean
  /** File the signed copy + certificate on the customer (protected `signed_executed` document) when it is signed. */
  autoFile: boolean
  /** Send any PDF for signature with placed fields, templates and bulk send (a new capability: on unless the owner turns it off). */
  customDocuments: boolean
  reminders: { enabled: boolean; days: number[] }
  /** Days a link is extended by when the office extends or resends an expired one. */
  extendDays: number
  emails: {
    /** The customer's signed-copy email carries the signed PDF + certificate, and the rep + company inbox get a copy. */
    signedCopy: boolean
    /** The rep (and company inbox) is told when a customer declines. */
    declineNotice: boolean
  }
}

export const DEFAULT_REMINDER_DAYS: readonly number[] = Object.freeze([2, 5])
export const EXTEND_DAYS_RANGE = { min: 1, max: 60 }
export const MAX_REMINDERS = 4
export const MAX_REMINDER_DAY = 30

export function defaultSigningSettings(hasProfile: boolean): SigningSettings {
  return {
    provider: 'native',
    consentStep: hasProfile,
    declineEnabled: hasProfile,
    autoFile: hasProfile,
    customDocuments: true,
    reminders: { enabled: false, days: [...DEFAULT_REMINDER_DAYS] },
    extendDays: 7,
    emails: { signedCopy: false, declineNotice: false },
  }
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function cleanReminderDays(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length > MAX_REMINDERS) return null
  const days = v.map(Number)
  if (!days.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_REMINDER_DAY)) return null
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b)
  return sorted.length === days.length ? sorted : null
}

/** Pure: the whole `orgs.settings` (or the key itself) → full settings. Anything invalid reads as its default. */
export function readSigningSettings(storedSettings: unknown): SigningSettings {
  const whole = obj(storedSettings)
  const hasProfile = !!whole.profile && typeof whole.profile === 'object'
  const s = SIGNING_SETTINGS_KEY in whole ? obj(whole[SIGNING_SETTINGS_KEY]) : {}
  const d = defaultSigningSettings(hasProfile)
  const rem = obj(s.reminders)
  const em = obj(s.emails)
  const extend = Number(s.extendDays)
  return {
    provider: SIGNING_PROVIDER_IDS.includes(s.provider as SigningProviderId) ? (s.provider as SigningProviderId) : d.provider,
    consentStep: typeof s.consentStep === 'boolean' ? s.consentStep : d.consentStep,
    declineEnabled: typeof s.declineEnabled === 'boolean' ? s.declineEnabled : d.declineEnabled,
    autoFile: typeof s.autoFile === 'boolean' ? s.autoFile : d.autoFile,
    customDocuments: typeof s.customDocuments === 'boolean' ? s.customDocuments : d.customDocuments,
    reminders: {
      enabled: typeof rem.enabled === 'boolean' ? rem.enabled : d.reminders.enabled,
      days: cleanReminderDays(rem.days) ?? d.reminders.days,
    },
    extendDays: Number.isInteger(extend) && extend >= EXTEND_DAYS_RANGE.min && extend <= EXTEND_DAYS_RANGE.max ? extend : d.extendDays,
    emails: {
      signedCopy: typeof em.signedCopy === 'boolean' ? em.signedCopy : d.emails.signedCopy,
      declineNotice: typeof em.declineNotice === 'boolean' ? em.declineNotice : d.emails.declineNotice,
    },
  }
}

/** A save from Settings: only known keys, each validated. Returns the whole new `signing` object to store. */
export function parseSigningPatch(current: SigningSettings, body: unknown): { set: SigningSettings } | { error: string } {
  const p = obj(obj(body).settings)
  const next: SigningSettings = { ...current, reminders: { ...current.reminders }, emails: { ...current.emails } }
  for (const [k, v] of Object.entries(p)) {
    if (k === 'consentStep' || k === 'declineEnabled' || k === 'autoFile' || k === 'customDocuments') {
      if (typeof v !== 'boolean') return { error: 'Use on or off' }
      next[k] = v
    } else if (k === 'provider') {
      if (v !== 'native') return { error: 'Only the built-in signing is available right now' }
      next.provider = 'native'
    } else if (k === 'reminders') {
      const r = obj(v)
      if ('enabled' in r) {
        if (typeof r.enabled !== 'boolean') return { error: 'Use on or off' }
        next.reminders.enabled = r.enabled
      }
      if ('days' in r) {
        const days = cleanReminderDays(r.days)
        if (!days) return { error: `Pick up to ${MAX_REMINDERS} different days, each 1–${MAX_REMINDER_DAY}` }
        next.reminders.days = days
      }
    } else if (k === 'extendDays') {
      const n = Number(v)
      if (!Number.isInteger(n) || n < EXTEND_DAYS_RANGE.min || n > EXTEND_DAYS_RANGE.max) return { error: `Links extend ${EXTEND_DAYS_RANGE.min}–${EXTEND_DAYS_RANGE.max} days` }
      next.extendDays = n
    } else if (k === 'emails') {
      const e = obj(v)
      for (const [ek, ev] of Object.entries(e)) {
        if (ek !== 'signedCopy' && ek !== 'declineNotice') return { error: `Unknown setting ${ek}` }
        if (typeof ev !== 'boolean') return { error: 'Use on or off' }
        next.emails[ek] = ev
      }
    } else {
      return { error: `Unknown setting ${k}` }
    }
  }
  return { set: next }
}
