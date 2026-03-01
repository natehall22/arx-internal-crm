export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void'

export interface JobInvoice {
  id: string
  job_id: string
  invoice_number: string
  status: InvoiceStatus
  issued_at: string | null
  due_at: string | null
  sent_at: string | null
  sent_to_email: string | null
  subtotal_cents: number
  total_cents: number
  notes: string | null
  created_at: string
  created_by: string | null
  voided_at: string | null
  void_reason: string | null
  pdf_path: string | null
}

export interface JobInvoiceItem {
  id: string
  invoice_id: string
  description: string
  qty: number
  unit_price_cents: number
  line_total_cents: number
  sort_order: number
  created_at: string
}

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
