/**
 * The pay sheet: one page-set per person for a pay week, the document owners hand out ("customer, address, pay type, amount, running
 * total, total to pay"). ONE model (`buildPaySheet`, pure) feeds the PDF (lib/pdf/payroll-person-sheet.ts) so what is printed is what
 * the screen shows. A locked week is read from its stored lines (loadPayWeek never recalculates an approved week); an open week is a
 * PREVIEW and says so on the page. No percentages or math unless the company turned `showMath` on. Looks (colors) and the plain-word
 * pay-type labels are per company, in `orgs.settings.paySheet`; nothing about any one company is in code.
 */
import type { PayWeek, PayWeekLine, PayWeekPerson } from '@/lib/payroll-pay-week'
import { payoutRoleWord } from '@/lib/payroll-pay-week'

export const PAY_SHEET_SETTINGS_KEY = 'paySheet'

export type PaySheetColors = { primary: string; accent: string; text: string; light: string }
export type PaySheetSettings = { colors: PaySheetColors; showMath: boolean; /** pay-type key (a payout role like `sales_rep`, or Hourly / Units / Minimum / Bonus / Adjustment / advance) -> the words on the sheet */ labels: Record<string, string> }

/** Neutral until a company sets its own (colors are brand values the owner saves; never typed in code). */
export const DEFAULT_PAY_SHEET: PaySheetSettings = { colors: { primary: '#222222', accent: '#555555', text: '#111111', light: '#F2F2F2' }, showMath: false, labels: {} }

const HEX = /^#[0-9a-fA-F]{6}$/

/** Tolerant reader of `orgs.settings.paySheet`: anything malformed falls back to the neutral value for that field. */
export function readPaySheetSettings(settings: unknown): PaySheetSettings {
  const raw = settings && typeof settings === 'object' ? ((settings as Record<string, unknown>)[PAY_SHEET_SETTINGS_KEY] as Record<string, unknown> | undefined) : undefined
  const c = (raw?.colors ?? {}) as Record<string, unknown>
  const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d)
  const labels: Record<string, string> = {}
  const rawLabels = raw?.labels && typeof raw.labels === 'object' ? (raw.labels as Record<string, unknown>) : {}
  for (const [k, v] of Object.entries(rawLabels)) if (/^[a-z_]{1,40}$/i.test(k) && typeof v === 'string' && v.trim() && v.trim().length <= 60) labels[k] = v.trim()
  return { colors: { primary: hex(c.primary, DEFAULT_PAY_SHEET.colors.primary), accent: hex(c.accent, DEFAULT_PAY_SHEET.colors.accent), text: hex(c.text, DEFAULT_PAY_SHEET.colors.text), light: hex(c.light, DEFAULT_PAY_SHEET.colors.light) }, showMath: raw?.showMath === true, labels }
}

/** The plain words for a line's pay type; a company's own label wins. */
const DEFAULT_LABELS: Record<string, string> = {
  sales_rep: 'Sales Commission',
  owner: 'Sales Commission',
  setter: 'Setter Commission',
  inspector: 'Inspection Commission',
  self_gen: 'Self-Generated Sales Commission',
  Hourly: 'Hourly Pay',
  Units: 'Per-Unit Pay',
  Minimum: 'Weekly Minimum',
  Bonus: 'Bonus',
  fix: 'Adjustment',
  balance: 'Balance Carried Over',
  advance: 'Advance',
  advance_recovery: 'Advance Repaid',
}
const titleCase = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase())

export function payTypeKey(l: PayWeekLine): string {
  if (l.kind === 'Commission') return l.roleKey ?? l.participantRole ?? 'sales_rep'
  if (l.kind === 'Adjustment') return l.adjustmentKind ?? 'fix'
  return l.kind
}

export function payTypeLabel(l: PayWeekLine, labels: Record<string, string>): string {
  const key = payTypeKey(l)
  if (labels[key]) return labels[key]
  if (l.kind === 'Bonus' && l.what && l.what !== 'Bonus') return titleCase(l.what)
  return DEFAULT_LABELS[key] ?? titleCase(payoutRoleWord(key))
}

export type PaySheetRow = { customer: string; address: string; payType: string; amount: number; running: number; math?: string }
export type PaySheet = {
  person: string
  payDate: string
  weekStart: string
  weekEnding: string
  rows: PaySheetRow[]
  /** What the check pays (never below $0). */
  total: number
  /** Set when the lines add to less than $0: that much is carried to next week. */
  carried: number
  preview: boolean
  showMath: boolean
}

/** One person's sheet from the week's own lines. Pure. A zero line is left off; the running total follows the line order. */
export function buildPaySheet(week: Pick<PayWeek, 'state' | 'period'>, p: PayWeekPerson, settings: Pick<PaySheetSettings, 'labels' | 'showMath'>): PaySheet {
  let running = 0
  const rows: PaySheetRow[] = []
  for (const l of p.lines) {
    if (Math.round(l.amount * 100) === 0) continue
    running = Math.round((running + l.amount) * 100) / 100
    rows.push({ customer: l.customer ?? '', address: l.address ?? (l.kind === 'Commission' ? l.what : ''), payType: payTypeLabel(l, settings.labels), amount: l.amount, running, ...(settings.showMath && l.math ? { math: l.math } : {}) })
  }
  return { person: p.name, payDate: week.period.payDate, weekStart: week.period.weekStart, weekEnding: week.period.weekEnding, rows, total: p.total, carried: p.raw < 0 ? Math.round(-p.raw * 100) / 100 : 0, preview: week.state !== 'approved', showMath: settings.showMath }
}

/** First_Last_Pay_Sheet_YYYY-MM-DD.pdf (the pay date). */
export function paySheetFilename(name: string, payDate: string): string {
  const base = name.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Pay'
  return `${base}_Pay_Sheet_${payDate}.pdf`
}
