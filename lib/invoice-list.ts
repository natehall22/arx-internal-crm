/**
 * Billing → All invoices: the pure parts, shared by the screen (components/billing/AllInvoices.tsx) and its CSV export
 * (/api/invoices/export) so the two can never disagree about which rows a filter keeps. Client-safe (no server imports).
 * Rows come from loadAllInvoices (lib/service-billing-db.ts); "owed" and "late" are never worked out again here.
 */
import { addDaysYmd } from '@/lib/service-plans'
import type { InvoiceListRow } from '@/lib/service-billing-db'

export type InvoiceListFilters = { status?: string; period?: string; customer?: string; q?: string }

export const INVOICE_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'open', label: 'Open (not due yet)' },
  { value: 'paid', label: 'Paid' },
  { value: 'draft', label: 'Draft' },
  { value: 'void', label: 'Void' },
]

export const INVOICE_PERIOD_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'earlier_this_year', label: 'Earlier this year' },
  { value: 'older', label: 'Older' },
]

/** One word for where an invoice stands: void, draft, overdue (a balance past its due day), open, or paid. */
export function invoiceStanding(r: Pick<InvoiceListRow, 'status' | 'balanceCents' | 'daysOverdue'>): 'void' | 'draft' | 'overdue' | 'open' | 'paid' {
  if (r.status === 'void') return 'void'
  if (r.status === 'draft') return 'draft'
  if (r.balanceCents > 0) return r.daysOverdue > 0 ? 'overdue' : 'open'
  return 'paid'
}

export function invoiceStandingLabel(r: Pick<InvoiceListRow, 'status' | 'balanceCents' | 'daysOverdue'>): string {
  const s = invoiceStanding(r)
  if (s === 'overdue') return `Overdue ${r.daysOverdue} day${r.daysOverdue === 1 ? '' : 's'}`
  return s === 'open' ? 'Open' : s === 'paid' ? 'Paid' : s === 'draft' ? 'Draft' : 'Void'
}

/** Which issue-date bucket a row is in, by the company's `today` (a draft uses the day it was made). */
export function invoicePeriodOf(r: Pick<InvoiceListRow, 'issuedAt' | 'createdAt'>, today: string): string {
  const day = (r.issuedAt ?? r.createdAt).slice(0, 10)
  const month = today.slice(0, 7)
  const lastMonth = addDaysYmd(`${month}-01`, -1).slice(0, 7)
  if (day.slice(0, 7) === month) return 'this_month'
  if (day.slice(0, 7) === lastMonth) return 'last_month'
  return day.slice(0, 4) === today.slice(0, 4) && day < `${month}-01` ? 'earlier_this_year' : 'older'
}

export function invoiceMatchesSearch(r: InvoiceListRow, q: string): boolean {
  const n = q.trim().toLowerCase()
  if (!n) return true
  return [r.invoiceNumber, r.customerName, r.jobNumber ?? ''].some((v) => v.toLowerCase().includes(n))
}

/** The rows that pass every chosen filter (an empty / missing value means "all"). */
export function filterInvoiceRows(rows: InvoiceListRow[], f: InvoiceListFilters, today: string): InvoiceListRow[] {
  return rows.filter(
    (r) =>
      (!f.status || invoiceStanding(r) === f.status) &&
      (!f.period || invoicePeriodOf(r, today) === f.period) &&
      (!f.customer || r.customerId === f.customer) &&
      (!f.q || invoiceMatchesSearch(r, f.q))
  )
}

export const INVOICE_EXPORT_COLUMNS = [
  { key: 'invoice', label: 'Invoice #', type: 'text' },
  { key: 'customer', label: 'Customer', type: 'text' },
  { key: 'job', label: 'Job #', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'issued', label: 'Issued', type: 'date' },
  { key: 'due', label: 'Due', type: 'date' },
  { key: 'total', label: 'Total', type: 'money' },
  { key: 'paid', label: 'Paid', type: 'money' },
  { key: 'owed', label: 'Owed', type: 'money' },
  { key: 'days_late', label: 'Days late', type: 'number' },
] as const

/** The rows as a report result (dollars, like every report), ready for the one CSV writer (lib/reporting/run.ts resultToCsv). */
export function invoiceRowsToResult(rows: InvoiceListRow[]) {
  return {
    columns: INVOICE_EXPORT_COLUMNS.map((c) => ({ key: c.key as string, label: c.label as string, type: c.type as never })),
    rows: rows.map((r) => ({
      invoice: r.invoiceNumber,
      customer: r.customerName,
      job: r.jobNumber ?? '',
      status: invoiceStandingLabel(r),
      issued: r.issuedAt ?? '',
      due: r.dueAt ?? '',
      total: r.totalCents / 100,
      paid: r.paidCents / 100,
      owed: r.balanceCents / 100,
      days_late: r.daysOverdue,
    })),
    matched: rows.length,
    scanned: rows.length,
    truncated: false,
    summary: null,
  }
}
