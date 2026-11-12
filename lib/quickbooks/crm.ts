/**
 * The CRM facts the worker posts — read at SEND time (never from the outbox payload), always company-scoped. An outbox row only
 * says "this record changed"; what QuickBooks receives is the record's state when we send, so two events for one record collapse
 * into one correct post and a stale payload can never overwrite a newer fact. Every loader returns null for a record that is not
 * in this company (a tampered row cannot make us post another company's data).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadSignedSaleInputs } from '@/lib/job-commission-base'
import { readStoredTaxLines, type TaxLine } from '@/lib/sales-tax'
import { orgDb } from '@/lib/supabase/org-db'

export type CrmCustomer = { id: string; name: string; email: string | null; phone: string | null; addressText: string | null; taxExempt: boolean }
export type CrmJob = { id: string; customerId: string | null; jobNumber: string; addressText: string; status: string | null; saleAmountCents: number | null; saleDate: string | null; createdAt: string | null; jobType: string | null; timeAndMaterials: boolean }
export type CrmInvoiceLine = { description: string; amountCents: number; qty: number | null; unitPriceCents: number | null; taxable: boolean; tradeSlug: string | null }
export type CrmInvoice = {
  /** Where the invoice comes from: the job's sale amount (one per job), or a CRM invoice row. */
  source: { table: 'production_jobs' | 'job_invoices'; id: string }
  docNumber: string
  txnDate: string
  dueDate: string | null
  customerId: string
  jobId: string | null
  lines: CrmInvoiceLine[]
  taxLines: TaxLine[]
  taxCents: number
  totalCents: number
  memo: string | null
  voided: boolean
  /** Non-void CRM invoices carrying sales tax on top of the sale amount (per-job mode cannot show them). */
  extraTaxCents: number
}
export type CrmPayment = { id: string; jobId: string | null; customerId: string | null; paidAt: string; amountCents: number; method: string | null; paymentType: string | null; note: string | null; applications: Array<{ invoiceId: string; appliedCents: number }> }
export type CrmBill = { id: string; vendorId: string; jobId: string | null; billNumber: string | null; billDate: string; amountCents: number; isCredit: boolean; costType: string; notes: string | null; voided: boolean; poNumber: string | null }
export type CrmVendor = { id: string; name: string; email: string | null; phone: string | null }

const cents = (dollars: unknown): number => Math.round((Number(dollars) || 0) * 100)
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

export async function loadCustomer(admin: SupabaseClient, orgId: string, id: string): Promise<CrmCustomer | null> {
  const { data } = await orgDb(admin, orgId).from('customers').select('id, name, email, phone, address_text, tax_exempt').eq('id', id).maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  const email = s(r.email)
  return { id, name: s(r.name) ?? s(r.address_text)?.split(',')[0] ?? 'Customer', email, phone: s(r.phone), addressText: s(r.address_text), taxExempt: r.tax_exempt === true }
}

export async function loadJob(admin: SupabaseClient, orgId: string, id: string): Promise<CrmJob | null> {
  const db = orgDb(admin, orgId)
  let res = await db.from('production_jobs').select('id, customer_id, job_number, address_text, status, sale_amount, sale_date, created_at, job_type, billing_mode').eq('id', id).maybeSingle()
  // Before migration 202611120030 there is no billing_mode: no job is billed by the hour.
  if (res.error && /billing_mode/.test(String(res.error.message))) res = await db.from('production_jobs').select('id, customer_id, job_number, address_text, status, sale_amount, sale_date, created_at, job_type').eq('id', id).maybeSingle()
  if (!res.data) return null
  const r = res.data as Record<string, unknown>
  return {
    id,
    customerId: s(r.customer_id),
    jobNumber: s(r.job_number) ?? id.slice(0, 8),
    addressText: s(r.address_text) ?? '',
    status: s(r.status),
    saleAmountCents: r.sale_amount == null ? null : cents(r.sale_amount),
    saleDate: day(r.sale_date),
    createdAt: s(r.created_at),
    jobType: s(r.job_type),
    timeAndMaterials: r.billing_mode === 'time_materials',
  }
}

/** The job's sales tax: the proposal's snapshot lines (rows without lines = one legacy lump). Cents; never above the sale. */
async function loadJobSalesTax(admin: SupabaseClient, orgId: string, jobId: string): Promise<{ taxCents: number; taxLines: TaxLine[] }> {
  const { data: job } = await orgDb(admin, orgId).from('production_jobs').select('id, project_id, linked_proposal_id, accepted_proposal_id').eq('id', jobId).maybeSingle()
  if (!job) return { taxCents: 0, taxLines: [] }
  const inputs = await loadSignedSaleInputs(admin, orgId, job as never)
  if ('error' in inputs) throw new Error('could not read the job’s sales tax')
  const taxCents = cents(inputs.salesTax)
  if (taxCents <= 0 || !inputs.taxProposalId) return { taxCents: Math.max(taxCents, 0), taxLines: [] }
  const { data: p } = await orgDb(admin, orgId).from('proposals').select('tax_lines').eq('id', inputs.taxProposalId).maybeSingle()
  const lines = readStoredTaxLines((p as { tax_lines?: unknown } | null)?.tax_lines) ?? []
  // The snapshot must add up to the tax the sale amount was built with; if it does not, send one lump rather than a wrong split.
  const sum = lines.reduce((t, l) => t + l.amount_cents, 0)
  return { taxCents, taxLines: sum === taxCents ? lines : [] }
}

/** Roofing mode: ONE invoice for the job = the sale amount (signed contract + signed change orders), sales tax shown separately. */
export async function loadJobSaleInvoice(admin: SupabaseClient, orgId: string, jobId: string): Promise<CrmInvoice | null> {
  const job = await loadJob(admin, orgId, jobId)
  if (!job || !job.customerId) return job ? { ...emptyInvoice(job), totalCents: 0 } : null
  const total = job.saleAmountCents ?? 0
  const { taxCents, taxLines } = total > 0 ? await loadJobSalesTax(admin, orgId, jobId) : { taxCents: 0, taxLines: [] as TaxLine[] }
  const { data: extra } = await orgDb(admin, orgId).from('job_invoices').select('tax_cents, status').eq('job_id', jobId)
  const extraTaxCents = ((extra ?? []) as Array<{ tax_cents: number | null; status: string }>).filter((i) => i.status !== 'draft' && i.status !== 'void').reduce((t, i) => t + (Number(i.tax_cents) || 0), 0)
  const pre = total - taxCents
  return {
    source: { table: 'production_jobs', id: jobId },
    docNumber: job.jobNumber,
    txnDate: job.saleDate ?? (job.createdAt ? job.createdAt.slice(0, 10) : ''),
    dueDate: null,
    customerId: job.customerId,
    jobId,
    lines: pre > 0 ? [{ description: `${job.jobType ? job.jobType[0].toUpperCase() + job.jobType.slice(1) : 'Exterior'} work${job.addressText ? ` — ${job.addressText}` : ''}`, amountCents: pre, qty: 1, unitPriceCents: pre, taxable: taxCents > 0, tradeSlug: job.jobType }] : [],
    taxLines,
    taxCents,
    totalCents: total,
    memo: null,
    voided: job.status === 'cancelled',
    extraTaxCents,
  }
}

function emptyInvoice(job: CrmJob): CrmInvoice {
  return { source: { table: 'production_jobs', id: job.id }, docNumber: job.jobNumber, txnDate: job.saleDate ?? '', dueDate: null, customerId: job.customerId ?? '', jobId: job.id, lines: [], taxLines: [], taxCents: 0, totalCents: 0, memo: null, voided: false, extraTaxCents: 0 }
}

/** Every-invoice mode (and time & materials jobs): one CRM invoice row, as issued. Drafts are never sent. */
export async function loadCrmInvoice(admin: SupabaseClient, orgId: string, invoiceId: string): Promise<(CrmInvoice & { draft: boolean }) | null> {
  const { data } = await orgDb(admin, orgId)
    .from('job_invoices')
    .select('id, job_id, customer_id, invoice_number, status, issued_at, due_at, created_at, total_cents, tax_cents, tax_lines, notes')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!data) return null
  const inv = data as Record<string, unknown>
  let customerId = s(inv.customer_id)
  const jobId = s(inv.job_id)
  if (!customerId && jobId) customerId = (await loadJob(admin, orgId, jobId))?.customerId ?? null
  // job_invoice_items hang off the invoice (no org_id of their own); the invoice above was loaded in this company.
  // org-scope-ok: items of an invoice already verified in this company
  const { data: items } = await admin.from('job_invoice_items').select('description, qty, unit_price_cents, line_total_cents, taxable, sort_order').eq('invoice_id', invoiceId).order('sort_order', { ascending: true })
  const taxCents = Number(inv.tax_cents) || 0
  const lines: CrmInvoiceLine[] = ((items ?? []) as Array<Record<string, unknown>>).map((i) => ({
    description: s(i.description) ?? 'Service',
    amountCents: Number(i.line_total_cents) || 0,
    qty: i.qty == null ? null : Number(i.qty),
    unitPriceCents: i.unit_price_cents == null ? null : Number(i.unit_price_cents),
    taxable: i.taxable === true,
    tradeSlug: null,
  }))
  const status = String(inv.status)
  return {
    source: { table: 'job_invoices', id: invoiceId },
    docNumber: s(inv.invoice_number) ?? invoiceId.slice(0, 8),
    txnDate: day(inv.issued_at) ?? day(inv.created_at) ?? '',
    dueDate: day(inv.due_at),
    customerId: customerId ?? '',
    jobId,
    lines,
    taxLines: readStoredTaxLines(inv.tax_lines) ?? [],
    taxCents,
    totalCents: Number(inv.total_cents) || 0,
    memo: s(inv.notes),
    voided: status === 'void',
    draft: status === 'draft',
    extraTaxCents: 0,
  }
}

/**
 * A recorded payment (money in, or negative = money back) with where it was applied. A job payment's company comes from its job,
 * a customer payment's from its own org_id — the row is returned only when that company is `orgId`.
 */
export async function loadPayment(admin: SupabaseClient, orgId: string, id: string): Promise<CrmPayment | null> {
  // org-scope-ok: job_payments.org_id is only set for payments without a job; the company is verified just below (job or org_id)
  const { data } = await admin.from('job_payments').select('id, job_id, org_id, customer_id, paid_at, amount_cents, payment_type, method, note').eq('id', id).maybeSingle()
  if (!data) return null
  const p = data as Record<string, unknown>
  const jobId = s(p.job_id)
  let customerId = s(p.customer_id)
  if (jobId) {
    const job = await loadJob(admin, orgId, jobId)
    if (!job) return null
    customerId = customerId ?? job.customerId
  } else if (p.org_id !== orgId) return null
  // org-scope-ok: applications of a payment already verified in this company
  const { data: apps } = await admin.from('invoice_payments').select('invoice_id, applied_cents').eq('job_payment_id', id)
  return {
    id,
    jobId,
    customerId,
    paidAt: day(p.paid_at) ?? '',
    amountCents: Number(p.amount_cents) || 0,
    method: s(p.method),
    paymentType: s(p.payment_type),
    note: s(p.note),
    applications: ((apps ?? []) as Array<{ invoice_id: string; applied_cents: number }>).map((a) => ({ invoiceId: a.invoice_id, appliedCents: Number(a.applied_cents) || 0 })),
  }
}

export async function loadVendor(admin: SupabaseClient, orgId: string, id: string): Promise<CrmVendor | null> {
  const { data } = await orgDb(admin, orgId).from('vendors').select('id, name, email, phone').eq('id', id).maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  return { id, name: s(r.name) ?? 'Vendor', email: s(r.email), phone: s(r.phone) }
}

export async function loadBill(admin: SupabaseClient, orgId: string, id: string): Promise<CrmBill | null> {
  const { data } = await orgDb(admin, orgId).from('purchase_order_bills').select('id, vendor_id, job_id, bill_number, bill_date, amount, is_credit, cost_type, notes, status, supplier_order_id, created_at').eq('id', id).maybeSingle()
  if (!data) return null
  const b = data as Record<string, unknown>
  const { data: po } = b.supplier_order_id ? await orgDb(admin, orgId).from('supplier_orders').select('po_number').eq('id', String(b.supplier_order_id)).maybeSingle() : { data: null }
  return {
    id,
    vendorId: String(b.vendor_id),
    jobId: s(b.job_id),
    billNumber: s(b.bill_number),
    billDate: day(b.bill_date) ?? day(b.created_at) ?? '',
    amountCents: cents(b.amount),
    isCredit: b.is_credit === true,
    costType: s(b.cost_type) ?? 'other',
    notes: s(b.notes),
    voided: b.status === 'void',
    poNumber: s((po as { po_number?: unknown } | null)?.po_number),
  }
}
