/**
 * The customer's receipt: ONE function, `sendPaymentReceipt`, called by the two payment writers — `recordJobPayment`
 * (lib/job-payment-record.ts: the office's "Add payment", online payments on a job's invoice) and `recordCustomerInvoicePayment`
 * (lib/invoices.ts: "Mark paid", cash / check at the door once the office confirms, online payments on a service invoice) — so
 * every way money comes in sends the same receipt. Built on the company's layout (renderCustomerEmail: its name / logo /
 * contact, never the product's) and sent through the invoice email's sender rules (resolveInvoiceSender: company From, the
 * opt-out / bounce list, "customer turned messages off", the demo-company guard in getMailTransport).
 *
 * Only for companies that have Automatic customer emails ON (Settings → Features; off by default, so a roofing company's
 * customers never get one). Money coming in only: refunds, voids and repeats send nothing. A receipt can never fail a
 * payment: every error is logged and swallowed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { renderCustomerEmail } from '@/lib/customer-email-layout'
import type { EmailCompany } from '@/lib/customer-email-layout'
import { loadInvoiceDocument, isUsableCustomerEmail } from '@/lib/invoice-document'
import { resolveInvoiceSender } from '@/lib/invoice-email'
import { CUSTOMER_PAYMENT_METHOD_LABELS, invoiceItemDateLabel } from '@/lib/invoice-lines'
import { formatCurrency } from '@/lib/job-payments'
import { getMailTransport } from '@/lib/setter-email'
import { orgDb } from '@/lib/supabase/org-db'
import type { JobInvoice } from '@/lib/types/invoices'

export type ReceiptInput = {
  /** The payment's own id: only for the log line. */
  paymentId: string
  amountCents: number
  /** YYYY-MM-DD, the day the money came in. */
  paidAt: string
  method: string
  /** Paid on this invoice (the receipt names it and what is still owed on it). */
  invoiceId?: string | null
  /** Else: paid on this job (the receipt names the address and what the job still owes). */
  jobId?: string | null
  /** What the job still owes after this payment, when the writer knows it (job payments). */
  jobRemainingCents?: number | null
}

const dateText = (ymd: string): string => invoiceItemDateLabel(ymd.slice(0, 10)) || ymd

export function methodLabel(method: string): string {
  return (CUSTOMER_PAYMENT_METHOD_LABELS as Record<string, string>)[method] ?? (method ? method.charAt(0).toUpperCase() + method.slice(1) : 'Payment')
}

/** Pure: the receipt email (subject, HTML, plain text) in the company's layout. */
export function renderPaymentReceipt(p: {
  company: EmailCompany
  customerName: string | null
  amountCents: number
  paidAt: string
  method: string
  invoiceNumber?: string | null
  address?: string | null
  /** Still owed after this payment (null = unknown: nothing is said about it). */
  remainingCents?: number | null
}): { subject: string; html: string; text: string } {
  const amount = formatCurrency(p.amountCents)
  const first = (p.customerName ?? '').trim().split(/\s+/)[0]
  const rows = [
    { label: 'Amount', value: amount },
    { label: 'Paid on', value: dateText(p.paidAt) },
    { label: 'Paid by', value: methodLabel(p.method) },
    ...(p.invoiceNumber ? [{ label: 'Invoice', value: p.invoiceNumber }] : []),
    ...(p.address ? [{ label: 'For', value: p.address }] : []),
    ...(p.remainingCents != null ? [{ label: p.remainingCents > 0 ? 'Still owed' : 'Balance', value: p.remainingCents > 0 ? formatCurrency(p.remainingCents) : '$0.00 — paid in full' }] : []),
  ]
  const { html, text } = renderCustomerEmail({
    company: p.company,
    preheader: `We received your payment of ${amount}.`,
    heading: 'Payment received — thank you',
    paragraphs: [`${first ? `Hi ${first}, we` : 'We'} received your payment. Keep this email as your receipt.`],
    rows,
    footnote: p.company.phone ? `Questions? Reply to this email or call ${p.company.phone}.` : 'Questions? Just reply to this email.',
    unsubscribeUrl: null,
  })
  return { subject: `Receipt for your ${amount} payment${p.company.name ? ` — ${p.company.name}` : ''}`, html, text }
}

async function loadTarget(admin: SupabaseClient, orgId: string, r: ReceiptInput): Promise<{ to: string; name: string | null; invoiceNumber: string | null; address: string | null; remainingCents: number | null } | null> {
  if (r.invoiceId) {
    // org-scope-ok: orgDb adds the company filter
    const { data } = await orgDb(admin, orgId).from('job_invoices').select('*').eq('id', r.invoiceId).maybeSingle()
    if (!data) return null
    const doc = await loadInvoiceDocument(admin, orgId, data as JobInvoice)
    return { to: (doc.billTo.email ?? '').trim(), name: doc.billTo.name, invoiceNumber: doc.invoice.invoice_number, address: null, remainingCents: Math.max(0, doc.balanceCents) }
  }
  if (!r.jobId) return null
  const { data: job } = await orgDb(admin, orgId).from('production_jobs').select('customer_id, address_text').eq('id', r.jobId).maybeSingle()
  const customerId = (job as { customer_id?: string | null } | null)?.customer_id
  if (!customerId) return null
  const { data: customer } = await orgDb(admin, orgId).from('customers').select('name, email').eq('id', customerId).maybeSingle()
  const c = customer as { name?: string | null; email?: string | null } | null
  return { to: (c?.email ?? '').trim(), name: c?.name ?? null, invoiceNumber: null, address: (job as { address_text?: string | null }).address_text ?? null, remainingCents: r.jobRemainingCents ?? null }
}

/** Email the receipt for money that just came in. 'sent' | 'skipped' (off, refund, no usable email, opted out) | 'failed' (logged). Never throws. */
export async function sendPaymentReceipt(admin: SupabaseClient, orgId: string, r: ReceiptInput): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    if (!(r.amountCents > 0)) return 'skipped'
    const { isOrgFeatureOn } = await import('@/lib/org-features-server')
    if (!(await isOrgFeatureOn(orgId, 'customerMessages'))) return 'skipped'
    const target = await loadTarget(admin, orgId, r)
    if (!target || !isUsableCustomerEmail(target.to)) return 'skipped'
    const sender = await resolveInvoiceSender(admin, orgId, target.to)
    if (!sender.ok) return 'skipped'
    const mail = renderPaymentReceipt({ company: sender.company, customerName: target.name, amountCents: r.amountCents, paidAt: r.paidAt, method: r.method, invoiceNumber: target.invoiceNumber, address: target.address, remainingCents: target.remainingCents })
    await getMailTransport(orgId).sendMail({ from: sender.from, to: target.to, replyTo: sender.replyTo, subject: mail.subject, html: mail.html, text: mail.text })
    return 'sent'
  } catch (e) {
    console.error('payment receipt failed', r.paymentId, e)
    return 'failed'
  }
}
