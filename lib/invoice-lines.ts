/**
 * Invoice line rules shared by the writer (lib/invoices.ts), the printed invoice and the customer email. Client-safe, pure.
 * A line is "each" (qty × price) or "hours" (time & materials: qty = hours, unit_price_cents = the hourly rate), and may
 * carry the day the work was done (service visits, hours worked). Migration 202611110060 adds `unit` / `service_date`.
 */
import { formatInTimeZone } from 'date-fns-tz'

import { formatCurrency } from '@/lib/job-payments'
import type { InvoiceItemUnit, JobInvoiceItem } from '@/lib/types/invoices'

/** How a customer paid an invoice without a job (job_payments.method CHECK allows these and more). */
export const CUSTOMER_PAYMENT_METHODS = ['cash', 'check', 'card', 'ach', 'other'] as const
export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number]
export const CUSTOMER_PAYMENT_METHOD_LABELS: Record<CustomerPaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  ach: 'Bank transfer',
  other: 'Other',
}

/** Most hours one line may carry (a month of full days); qty is numeric(10,2). */
export const MAX_LINE_HOURS = 744

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function isYmd(v: unknown): v is string {
  return typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v
}

/** The unit / service-day columns a line write sends (only what is set), or why the line is refused. */
export function invoiceItemLineFields(item: {
  unit?: InvoiceItemUnit | string | null
  service_date?: string | null
  qty?: number | null
}): { value: { unit?: InvoiceItemUnit; service_date?: string } } | { error: string } {
  const value: { unit?: InvoiceItemUnit; service_date?: string } = {}
  if (item.unit != null && item.unit !== '') {
    if (item.unit !== 'hour') return { error: 'Unknown line unit' }
    const qty = Number(item.qty ?? 1)
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_LINE_HOURS) return { error: `Hours must be above 0 and at most ${MAX_LINE_HOURS}` }
    if (Math.round(qty * 100) !== qty * 100) return { error: 'Hours can have at most 2 decimals (e.g. 1.25)' }
    value.unit = 'hour'
  }
  if (item.service_date != null && item.service_date !== '') {
    if (!isYmd(item.service_date)) return { error: 'The work date must be a real day (YYYY-MM-DD)' }
    value.service_date = item.service_date
  }
  return { value }
}

/** "2.5 hrs" for an hours line, else the quantity exactly as stored (job invoices print as they always have). */
export function invoiceItemQtyLabel(item: Pick<JobInvoiceItem, 'qty' | 'unit'>): string {
  if (item.unit === 'hour') return `${Number(item.qty)} ${Number(item.qty) === 1 ? 'hr' : 'hrs'}`
  return String(item.qty)
}

/** "$80.00/hr" for an hours line, else the plain unit price. */
export function invoiceItemPriceLabel(item: Pick<JobInvoiceItem, 'unit_price_cents' | 'unit'>): string {
  return item.unit === 'hour' ? `${formatCurrency(item.unit_price_cents)}/hr` : formatCurrency(item.unit_price_cents)
}

/** "Tue, Nov 3, 2026" for a line's work day (calendar date, no time zone shift), or ''. */
export function invoiceItemDateLabel(serviceDate: string | null | undefined): string {
  if (!isYmd(serviceDate)) return ''
  return formatInTimeZone(new Date(`${serviceDate}T12:00:00Z`), 'UTC', 'EEE, MMM d, yyyy')
}
