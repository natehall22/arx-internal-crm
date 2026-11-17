/**
 * Payment terms: ONE answer to "when is this invoice due". The company's default lives in `orgs.settings.paymentTerms`
 * (Settings → Payments & tax, owners, path ['paymentTerms']); a customer may override it (`customers.payment_terms`,
 * migration 202611300050). The due day is worked out ONCE, when the invoice is issued (`finalizeAndSendInvoice`), as
 * the issue day in the company's own time zone + the terms' days, and stored in `job_invoices.due_at`. "Overdue" is
 * simply a balance owed past that day (`invoiceDaysOverdue`), the same reading the Unpaid list, reminders and the
 * rpt_invoices view already use. Pure helpers here; the loader is server only (it takes the admin client).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { addDaysYmd, daysBetweenYmd } from '@/lib/service-plans'
import { isMissingColumn } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

export const PAYMENT_TERMS = ['due_on_receipt', 'net_15', 'net_30'] as const
export type PaymentTerms = (typeof PAYMENT_TERMS)[number]
export const PAYMENT_TERMS_SETTINGS_KEY = 'paymentTerms'
export const DEFAULT_PAYMENT_TERMS: PaymentTerms = 'due_on_receipt'

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  due_on_receipt: 'Due on receipt',
  net_15: 'Net 15',
  net_30: 'Net 30',
}

const TERMS_DAYS: Record<PaymentTerms, number> = { due_on_receipt: 0, net_15: 15, net_30: 30 }

export function parsePaymentTerms(v: unknown): PaymentTerms | null {
  return typeof v === 'string' && (PAYMENT_TERMS as readonly string[]).includes(v) ? (v as PaymentTerms) : null
}

export function paymentTermsDays(t: PaymentTerms): number {
  return TERMS_DAYS[t]
}

/** The company default out of `orgs.settings` (or the `paymentTerms` object itself). Anything missing or bad is Due on receipt. */
export function readOrgPaymentTerms(stored: unknown): PaymentTerms {
  const o = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const inner = o[PAYMENT_TERMS_SETTINGS_KEY] && typeof o[PAYMENT_TERMS_SETTINGS_KEY] === 'object' ? (o[PAYMENT_TERMS_SETTINGS_KEY] as Record<string, unknown>) : o
  return parsePaymentTerms(inner.defaultTerms) ?? DEFAULT_PAYMENT_TERMS
}

/** A customer's own terms win over the company's. */
export function effectivePaymentTerms(orgDefault: PaymentTerms, customerOverride: unknown): PaymentTerms {
  return parsePaymentTerms(customerOverride) ?? orgDefault
}

/** The day an invoice issued on `issueDay` (the company's calendar day) falls due. */
export function dueDayFor(issueDay: string, terms: PaymentTerms): string {
  return addDaysYmd(issueDay, TERMS_DAYS[terms])
}

/** Whole days an invoice is past due as of `today` (company day): 0 when paid up, not yet due, or without a due day. */
export function invoiceDaysOverdue(dueDay: string | null | undefined, today: string, balanceCents: number): number {
  if (!dueDay || !(balanceCents > 0)) return 0
  const due = dueDay.slice(0, 10)
  return Math.max(0, daysBetweenYmd(due, today))
}

/** The terms an issued invoice was on, by its issue and due days ("Net 30"); '' when the gap matches none (a hand-set due day). */
export function termsLabelFor(issued: string | null | undefined, due: string | null | undefined): string {
  if (!issued || !due) return ''
  const gap = daysBetweenYmd(issued.slice(0, 10), due.slice(0, 10))
  const match = (PAYMENT_TERMS as readonly PaymentTerms[]).find((t) => TERMS_DAYS[t] === gap)
  return match ? PAYMENT_TERMS_LABELS[match] : ''
}

/** What the customer reads under the invoice number: "Due on receipt" or "Due Dec 3 · Net 30". `issued` / `due` are YYYY-MM-DD. */
export function dueLabel(issued: string | null | undefined, due: string | null | undefined, dateText: (ymd: string) => string): string {
  if (!due) return PAYMENT_TERMS_LABELS.due_on_receipt
  const d = due.slice(0, 10)
  const i = issued ? issued.slice(0, 10) : null
  const gap = i ? daysBetweenYmd(i, d) : null
  if (gap === 0) return PAYMENT_TERMS_LABELS.due_on_receipt
  const match = (PAYMENT_TERMS as readonly PaymentTerms[]).find((t) => TERMS_DAYS[t] === gap)
  return `Due ${dateText(d)}${match ? ` · ${PAYMENT_TERMS_LABELS[match]}` : ''}`
}

/** The company default and the customer's own override (null = none). A missing customer, or a database without migration 202611300050, has no override. */
export async function loadTermsChoice(admin: SupabaseClient, orgId: string, customerId: string | null): Promise<{ orgDefault: PaymentTerms; override: PaymentTerms | null }> {
  const { data: org } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
  const orgDefault = readOrgPaymentTerms((org as { settings?: unknown } | null)?.settings)
  if (!customerId) return { orgDefault, override: null }
  const { data, error } = await orgDb(admin, orgId).from('customers').select('payment_terms').eq('id', customerId).maybeSingle()
  if (error) {
    if (isMissingColumn(error, 'payment_terms')) return { orgDefault, override: null }
    throw new Error(`payment terms: ${error.message}`)
  }
  return { orgDefault, override: parsePaymentTerms((data as { payment_terms?: unknown } | null)?.payment_terms) }
}

/** The terms that apply to one customer (their override, else the company default). */
export async function loadPaymentTerms(admin: SupabaseClient, orgId: string, customerId: string | null): Promise<PaymentTerms> {
  const c = await loadTermsChoice(admin, orgId, customerId)
  return effectivePaymentTerms(c.orgDefault, c.override)
}
