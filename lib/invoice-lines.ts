/**
 * Invoice line rules shared by the writer (lib/invoices.ts), the printed invoice and the customer email. Client-safe, pure.
 * A line is "each" (qty × price) or "hours" (time & materials: qty = hours, unit_price_cents = the hourly rate), and may
 * carry the day the work was done (service visits, hours worked). Migration 202611110060 adds `unit` / `service_date`.
 */
import type { InvoiceItemUnit, JobInvoiceItem } from '@/lib/types/invoices'

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

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function qtyText(qty: number): string {
  return Number(qty).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** "2.5 hrs" for an hours line, else the plain quantity. */
export function invoiceItemQtyLabel(item: Pick<JobInvoiceItem, 'qty' | 'unit'>): string {
  if (item.unit === 'hour') return `${qtyText(item.qty)} ${Number(item.qty) === 1 ? 'hr' : 'hrs'}`
  return qtyText(item.qty)
}

/** "$80.00/hr" for an hours line, else the plain unit price. */
export function invoiceItemPriceLabel(item: Pick<JobInvoiceItem, 'unit_price_cents' | 'unit'>): string {
  return item.unit === 'hour' ? `${money(item.unit_price_cents)}/hr` : money(item.unit_price_cents)
}

/** "Tue, Nov 3, 2026" for a line's work day (calendar date, no time zone shift), or ''. */
export function invoiceItemDateLabel(serviceDate: string | null | undefined): string {
  if (!isYmd(serviceDate)) return ''
  return new Date(`${serviceDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
