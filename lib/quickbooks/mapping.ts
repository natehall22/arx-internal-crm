/**
 * What a company chose for QuickBooks — the ONE reader/validator of `orgs.settings.quickbooks` (written ONLY at path ['quickbooks'],
 * owners, through `saveQuickBooksSettings`). Plain words in every message: the owner reads these.
 *
 * Nothing posts until `mappingProblems()` is empty AND the owner pressed "Start sending" (`confirmedAt`). Nothing dated before
 * `startDate` ever posts. We never create or edit accounts, items or tax codes in QuickBooks: every id here is one the owner
 * picked from their own QuickBooks lists.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { mergeOrgSettings } from '@/lib/org-settings'
import { readSalesTaxSettings, type SalesTaxSettings } from '@/lib/sales-tax'

export const QUICKBOOKS_SETTINGS_KEY = 'quickbooks'

/** roofing = one invoice per job for the sale amount (a signed change order updates it); every_invoice = each CRM invoice (service companies). */
export type QbInvoiceMode = 'per_job' | 'per_invoice'
export type QbTaxMode = 'none' | 'quickbooks' | 'code'

export type QbSettings = {
  startDate: string | null
  invoiceMode: QbInvoiceMode
  income: { defaultItemId: string | null; byTrade: Record<string, string> }
  tax: { mode: QbTaxMode; taxCodeId: string | null; /** CRM sales-tax rate id -> QuickBooks tax rate id (code mode) */ rateMap: Record<string, string> }
  depositToAccountId: string | null
  /** Only needed when the company has more than one Accounts Receivable account. */
  receivablesAccountId: string | null
  bills: { enabled: boolean; expenseAccountId: string | null; classId: string | null }
  /** CRM vendor ids to send as 1099 vendors. */
  vendors1099: string[]
  confirmedAt: string | null
  confirmedBy: string | null
}

export const EMPTY_QB_SETTINGS: Readonly<QbSettings> = Object.freeze<QbSettings>({
  startDate: null,
  invoiceMode: 'per_job',
  income: { defaultItemId: null, byTrade: {} },
  tax: { mode: 'none', taxCodeId: null, rateMap: {} },
  depositToAccountId: null,
  receivablesAccountId: null,
  bills: { enabled: false, expenseAccountId: null, classId: null },
  vendors1099: [],
  confirmedAt: null,
  confirmedBy: null,
})

const ID = /^[A-Za-z0-9_\-:.]{1,64}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const id = (v: unknown): string | null => (typeof v === 'string' && ID.test(v.trim()) ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function isRealDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** Reads whatever is stored; anything unusable becomes "not chosen yet". Never throws. */
export function readQbSettings(orgSettings: unknown): QbSettings {
  const q = obj(obj(orgSettings)[QUICKBOOKS_SETTINGS_KEY])
  const income = obj(q.income)
  const tax = obj(q.tax)
  const bills = obj(q.bills)
  const byTrade: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj(income.byTrade))) {
    const i = id(v)
    if (i && /^[a-z0-9_\-]{1,40}$/.test(k)) byTrade[k] = i
  }
  const rateMap: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj(tax.rateMap))) {
    const i = id(v)
    if (i && /^[a-z0-9_\-]{1,40}$/.test(k)) rateMap[k] = i
  }
  return {
    startDate: isRealDay(q.startDate) ? q.startDate : null,
    invoiceMode: q.invoiceMode === 'per_invoice' ? 'per_invoice' : 'per_job',
    income: { defaultItemId: id(income.defaultItemId), byTrade },
    tax: { mode: tax.mode === 'quickbooks' || tax.mode === 'code' ? tax.mode : 'none', taxCodeId: id(tax.taxCodeId), rateMap },
    depositToAccountId: id(q.depositToAccountId),
    receivablesAccountId: id(q.receivablesAccountId),
    bills: { enabled: bills.enabled === true, expenseAccountId: id(bills.expenseAccountId), classId: id(bills.classId) },
    vendors1099: Array.isArray(q.vendors1099) ? Array.from(new Set(q.vendors1099.filter((x): x is string => typeof x === 'string' && ID.test(x)))).slice(0, 500) : [],
    confirmedAt: typeof q.confirmedAt === 'string' ? q.confirmedAt : null,
    confirmedBy: typeof q.confirmedBy === 'string' ? q.confirmedBy : null,
  }
}

export type QbProblem = { field: string; message: string }

/**
 * What still has to be chosen before anything posts. Plain words. `salesTax` is the company's CRM tax settings (to check every
 * active rate has a QuickBooks rate in code mode). Empty list = ready.
 */
export function mappingProblems(s: QbSettings, salesTax: SalesTaxSettings | null): QbProblem[] {
  const p: QbProblem[] = []
  if (!s.startDate) p.push({ field: 'startDate', message: 'Pick the first day the CRM should send to QuickBooks. Nothing before it is ever sent.' })
  if (!s.income.defaultItemId) p.push({ field: 'income', message: 'Pick where sales go in QuickBooks (the product or service for your work).' })
  if (!s.depositToAccountId) p.push({ field: 'depositTo', message: 'Pick the QuickBooks account payments are deposited to (often Undeposited Funds).' })
  if (s.tax.mode === 'code') {
    if (!s.tax.taxCodeId) p.push({ field: 'tax', message: 'Pick the QuickBooks sales tax code to use.' })
    else {
      const active = (salesTax?.rates ?? []).filter((r) => r.active)
      for (const r of active) if (!s.tax.rateMap[r.id]) p.push({ field: 'tax', message: `Sales tax “${r.name}” (${r.percent}%) is not in the QuickBooks tax code you picked. Pick a code that includes it.` })
    }
  }
  if (s.bills.enabled && !s.bills.expenseAccountId) p.push({ field: 'bills', message: 'Pick where vendor bills go in QuickBooks (an expense account), or turn vendor bills off.' })
  return p
}

export function mappingReady(s: QbSettings, salesTax: SalesTaxSettings | null): boolean {
  return !!s.confirmedAt && mappingProblems(s, salesTax).length === 0
}

/** The company's CRM sales-tax settings from `orgs.settings`, or null when it charges none / is not set up. */
export function salesTaxFrom(orgSettings: unknown): SalesTaxSettings | null {
  const n = readSalesTaxSettings(orgSettings)
  return n && n.enabled ? n : null
}

/** Validates and saves the owner's choices (path ['quickbooks'], one per-key SQL merge). Ids are checked for shape only; the screen offers QuickBooks' own lists. */
export async function saveQuickBooksSettings(
  admin: SupabaseClient,
  orgId: string,
  input: unknown,
  userId: string,
  now = new Date()
): Promise<{ ok: true; settings: QbSettings } | { ok: false; error: string }> {
  const raw = obj(input)
  const next = readQbSettings({ [QUICKBOOKS_SETTINGS_KEY]: raw })
  if (raw.startDate != null && raw.startDate !== '' && !isRealDay(raw.startDate)) return { ok: false, error: 'The start date is not a real date.' }
  const confirm = raw.confirm === true
  const stored: Record<string, unknown> = {
    startDate: next.startDate,
    invoiceMode: next.invoiceMode,
    income: next.income,
    tax: next.tax,
    depositToAccountId: next.depositToAccountId,
    receivablesAccountId: next.receivablesAccountId,
    bills: next.bills,
    vendors1099: next.vendors1099,
    // Any change un-confirms; "Start sending" is its own deliberate press.
    confirmedAt: confirm ? now.toISOString() : null,
    confirmedBy: confirm ? userId : null,
  }
  const { error } = await mergeOrgSettings(admin, orgId, stored, { path: [QUICKBOOKS_SETTINGS_KEY] })
  if (error) return { ok: false, error: 'Could not save. Please try again.' }
  return { ok: true, settings: { ...next, confirmedAt: stored.confirmedAt as string | null, confirmedBy: stored.confirmedBy as string | null } }
}
