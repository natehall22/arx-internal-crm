export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void'
/** 'service' = recurring service billed to a customer without a job (migration 202611110060). */
export type InvoiceKind = 'deposit' | 'final' | 'standard' | 'service'

export interface JobInvoice {
  id: string
  /** NULL = an invoice without a job (recurring service): customer_id is set instead (migration 202611110060). */
  job_id: string | null
  /** Set by trigger from the job (job invoices) or by the writer (invoices without a job); NULL before migration 202611100040. */
  org_id?: string | null
  customer_id?: string | null
  property_id?: string | null
  invoice_number: string
  invoice_kind: InvoiceKind
  status: InvoiceStatus
  issued_at: string | null
  due_at: string | null
  sent_at: string | null
  sent_to_email: string | null
  subtotal_cents: number
  /** Sales tax (lib/sales-tax.ts); null before migration 202611110040 or on invoices never recalculated since. */
  taxable_subtotal_cents?: number | null
  tax_cents?: number | null
  tax_lines?: unknown
  total_cents: number
  notes: string | null
  public_note: string | null
  internal_note: string | null
  created_at: string
  created_by: string | null
  voided_at: string | null
  void_reason: string | null
  pdf_path: string | null
}

export const INVOICE_NOTE_TEMPLATES = {
  deposit: 'Remaining balance due at installation.',
  final: 'Payment due upon completion.',
  net7: 'Payment due within 7 days of invoice date.',
  net14: 'Payment due within 14 days of invoice date.',
  due_upon_completion: 'Payment due upon completion of work.',
} as const

export type InvoiceNoteTemplate = keyof typeof INVOICE_NOTE_TEMPLATES

export interface JobInvoiceItem {
  id: string
  invoice_id: string
  description: string
  qty: number
  unit_price_cents: number
  line_total_cents: number
  sort_order: number
  /** Sales tax: true = taxed at the company's rates; null/false = not taxed. */
  taxable?: boolean | null
  /** Service lines (migration 202611110060): the visit billed, the day of the work, a monthly plan's month. */
  work_order_id?: string | null
  service_date?: string | null
  service_plan_id?: string | null
  billing_month?: string | null
  /** null = each; 'hour' = time & materials (qty = hours, unit_price_cents = hourly rate). */
  unit?: InvoiceItemUnit | null
  created_at: string
}

export type InvoiceItemUnit = 'hour'

export interface InvoicePayment {
  id: string
  invoice_id: string
  job_payment_id: string
  applied_cents: number
  created_at: string
  created_by: string | null
}

export interface InvoiceWithItems extends JobInvoice {
  items: JobInvoiceItem[]
  payments: InvoicePayment[]
  applied_cents: number
  balance_cents: number
}

export interface InvoiceItemInput {
  description: string
  qty?: number
  unit_price_cents: number
  sort_order?: number
  taxable?: boolean
  /** Hours line: qty = hours, unit_price_cents = rate; service_date = the day worked. */
  unit?: InvoiceItemUnit | null
  service_date?: string | null
}

export interface InvoiceBalance {
  total_cents: number
  applied_cents: number
  balance_cents: number
  is_paid: boolean
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  void: 'Void',
}

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
}

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  deposit: 'Deposit',
  final: 'Final',
  standard: 'Standard',
  service: 'Service',
}

export interface DepositInfo {
  hasDeposit: boolean
  depositPayments: Array<{ id: string; amount_cents: number }>
  totalDepositCents: number
  saleAmountCents: number
  requiredDepositCents: number
  hasActiveDepositInvoice: boolean
  appliedDepositCents: number
}
