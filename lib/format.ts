/**
 * The one place money, dates and times are formatted. Everything renders in the org timezone
 * (CALENDAR_BUSINESS_TZ) so a phone set to another zone shows the same day as the office.
 * Replaces the per-file formatCurrency / formatDate / toLocaleDateString copies (CLAUDE.md Known Redundancy #6).
 */
import { formatInTimeZone } from 'date-fns-tz'

import { CALENDAR_BUSINESS_TZ } from '@/lib/calendar-business-tz'

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const MONEY_WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const NUMBER = new Intl.NumberFormat('en-US')

type Maybe<T> = T | null | undefined
const EMPTY = '—'

function num(v: Maybe<number | string>): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** $1,234.56 — negatives as -$1,234.56. Empty/invalid → "—". */
export function formatMoney(v: Maybe<number | string>, opts?: { whole?: boolean }): string {
  const n = num(v)
  if (n == null) return EMPTY
  return (opts?.whole ? MONEY_WHOLE : MONEY).format(n)
}

/** Money stored as integer cents. */
export function formatCents(cents: Maybe<number | string>): string {
  const n = num(cents)
  return n == null ? EMPTY : MONEY.format(n / 100)
}

export function formatNumber(v: Maybe<number | string>): string {
  const n = num(v)
  return n == null ? EMPTY : NUMBER.format(n)
}

export function formatPercent(v: Maybe<number | string>, digits = 0): string {
  const n = num(v)
  return n == null ? EMPTY : `${n.toFixed(digits)}%`
}

/** A bare `yyyy-MM-dd` is a calendar day, not an instant: pin it to noon so no zone can shift it. */
function toDate(v: Maybe<string | Date>): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v)
  return Number.isNaN(d.getTime()) ? null : d
}

function inTz(v: Maybe<string | Date>, pattern: string, bareDay = false): string {
  const d = toDate(v)
  if (!d) return EMPTY
  // Calendar days (no time) must not be zone-shifted.
  const tz = bareDay && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'UTC' : CALENDAR_BUSINESS_TZ
  return formatInTimeZone(d, tz, pattern)
}

/** Oct 22, 2026 */
export const formatDate = (v: Maybe<string | Date>) => inTz(v, 'MMM d, yyyy', true)
/** Oct 22 */
export const formatDateShort = (v: Maybe<string | Date>) => inTz(v, 'MMM d', true)
/** Thu, Oct 22 */
export const formatDateWeekday = (v: Maybe<string | Date>) => inTz(v, 'EEE, MMM d', true)
/** 3:30 PM */
export const formatTime = (v: Maybe<string | Date>) => inTz(v, 'h:mm a')
/** Oct 22, 3:30 PM */
export const formatDateTime = (v: Maybe<string | Date>) => inTz(v, 'MMM d, h:mm a')

/** "(704) 555-0142" for 10/11-digit US numbers; anything else is returned as typed. */
export function formatPhone(v: Maybe<string>): string {
  if (!v) return EMPTY
  const d = v.replace(/\D/g, '')
  const t = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : v
}
