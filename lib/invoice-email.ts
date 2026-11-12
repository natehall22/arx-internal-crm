/**
 * Emailing an invoice to the customer, rendered from THE invoice model (lib/invoice-document.ts) — the company's own
 * name, address, phone and email (never the product's). Every invoice — a job's or a recurring service's — is really
 * emailed by `sendCustomerInvoice` (the office's "Send invoice" used to only mark a job invoice sent; nothing reached the
 * customer). With online payments on, `sendCustomerInvoiceOnline` (lib/online-payments/autopay.ts) passes a pay link
 * (`payUrl`) while anything is still owed, and charges a card on file first for invoices without a job.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { escapeHtml } from '@/lib/html'
import { formatCurrency } from '@/lib/job-payments'
import { finalizeAndSendInvoice } from '@/lib/invoices'
import { invoiceItemDateLabel, invoiceItemPriceLabel, invoiceItemQtyLabel } from '@/lib/invoice-lines'
import { isUsableCustomerEmail, loadInvoiceDocument, type InvoiceDocument } from '@/lib/invoice-document'
import { companyIdentity } from '@/lib/customer-messages-db'
import { normalizeEmail } from '@/lib/customer-message-channels'
import { suppressionOf } from '@/lib/customer-message-suppressions'
import { isMissingColumn } from '@/lib/supabase/errors'
import { getMailTransport } from '@/lib/setter-email'
import { orgDb } from '@/lib/supabase/org-db'
import type { JobInvoice } from '@/lib/types/invoices'

const money = formatCurrency

function dateLabel(ymd: string | null | undefined): string {
  return invoiceItemDateLabel(ymd ?? null)
}

/** Pure: subject + HTML + plain text for one invoice. `payUrl` is the hook for online payment (null today). */
export function renderInvoiceEmail(doc: InvoiceDocument, opts: { payUrl?: string | null } = {}): { subject: string; html: string; text: string } {
  const { invoice, company, billTo } = doc
  const from = company.legalName || 'us'
  const subject = `Invoice ${invoice.invoice_number}${company.legalName ? ` from ${company.legalName}` : ''}`
  const td = 'padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;'
  const tdr = `${td}text-align:right;white-space:nowrap;`
  const rows = doc.items
    .map((it) => {
      const day = dateLabel(it.service_date)
      return `<tr><td style="${td}">${escapeHtml(it.description)}${day ? `<div style="font-size:12px;color:#4b5563;">${escapeHtml(day)}</div>` : ''}</td>`
        + `<td style="${tdr}">${escapeHtml(invoiceItemQtyLabel(it))}</td><td style="${tdr}">${escapeHtml(invoiceItemPriceLabel(it))}</td>`
        + `<td style="${tdr}">${escapeHtml(money(it.line_total_cents))}</td></tr>`
    })
    .join('')
  const totalRow = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:6px 8px;font-size:14px;color:#111827;${strong ? 'font-weight:700;' : ''}">${escapeHtml(label)}</td><td style="padding:6px 8px;font-size:14px;color:#111827;text-align:right;${strong ? 'font-weight:700;' : ''}">${escapeHtml(value)}</td></tr>`
  const totals = [
    totalRow('Subtotal', money(invoice.subtotal_cents)),
    ...doc.taxRows.map((r) => totalRow(r.label, money(r.amountCents))),
    totalRow('Total', money(invoice.total_cents), true),
    ...(doc.appliedCents > 0 ? [totalRow('Paid', `(${money(doc.appliedCents)})`)] : []),
    totalRow('Balance due', doc.isPaid ? 'Paid — thank you' : money(doc.balanceCents), true),
  ].join('')
  const contact = [company.phone, company.email].filter(Boolean).map((v) => escapeHtml(v)).join(' · ')
  const due = invoice.due_at ? `Due ${dateLabel(invoice.due_at)}` : 'Due on receipt'
  const pay = opts.payUrl
    ? `<p style="margin:20px 0;"><a href="${escapeHtml(opts.payUrl)}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Pay ${escapeHtml(money(doc.balanceCents))}</a></p>`
    : ''
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111827;">
  <div style="font-size:20px;font-weight:700;">${escapeHtml(company.legalName)}</div>
  ${company.address ? `<div style="font-size:13px;color:#374151;white-space:pre-line;">${escapeHtml(company.address)}</div>` : ''}
  ${contact ? `<div style="font-size:13px;color:#374151;">${contact}</div>` : ''}
  <h1 style="font-size:22px;margin:24px 0 4px;">Invoice ${escapeHtml(invoice.invoice_number)}</h1>
  <div style="font-size:14px;color:#374151;">${escapeHtml(billTo.name)}${billTo.address ? ` · ${escapeHtml(billTo.address)}` : ''}</div>
  <div style="font-size:14px;color:#374151;margin-bottom:16px;">${escapeHtml(due)}</div>
  ${pay}
  <table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 16px;">
    <tr><th style="text-align:left;padding:8px;font-size:12px;color:#374151;border-bottom:2px solid #111827;">Description</th><th style="text-align:right;padding:8px;font-size:12px;color:#374151;border-bottom:2px solid #111827;">Qty</th><th style="text-align:right;padding:8px;font-size:12px;color:#374151;border-bottom:2px solid #111827;">Price</th><th style="text-align:right;padding:8px;font-size:12px;color:#374151;border-bottom:2px solid #111827;">Amount</th></tr>
    ${rows}
  </table>
  <table role="presentation" style="width:100%;max-width:320px;margin-left:auto;border-collapse:collapse;">${totals}</table>
  ${invoice.public_note ? `<p style="font-size:14px;color:#111827;white-space:pre-line;margin-top:20px;">${escapeHtml(invoice.public_note)}</p>` : ''}
  <p style="font-size:14px;color:#374151;margin-top:24px;">Questions about this invoice? Reply to this email${company.phone ? ` or call ${escapeHtml(company.phone)}` : ''}.</p>
</div>`
  const text = [
    company.legalName,
    `Invoice ${invoice.invoice_number} — ${due}`,
    `${billTo.name}${billTo.address ? `, ${billTo.address}` : ''}`,
    '',
    ...doc.items.map((it) => `${it.description}${it.service_date ? ` (${dateLabel(it.service_date)})` : ''}: ${invoiceItemQtyLabel(it)} × ${invoiceItemPriceLabel(it)} = ${money(it.line_total_cents)}`),
    '',
    `Subtotal ${money(invoice.subtotal_cents)}`,
    ...doc.taxRows.map((r) => `${r.label} ${money(r.amountCents)}`),
    `Total ${money(invoice.total_cents)}`,
    `Balance due ${doc.isPaid ? 'Paid — thank you' : money(doc.balanceCents)}`,
    ...(opts.payUrl ? ['', `Pay online: ${opts.payUrl}`] : []),
    ...(invoice.public_note ? ['', invoice.public_note] : []),
    '',
    `Questions? Reply to this email${company.phone ? ` or call ${company.phone}` : ''}. — ${from}`,
  ].join('\n')
  return { subject, html, text }
}

type InvoiceSender = { ok: true; from: string; replyTo: string } | { ok: false; status: 400 | 409 | 503; error: string }

/**
 * Who an invoice email comes from and whether it may go: the SAME rules as customer messages (lib/customer-messages-db.ts) —
 * From and Reply-To are the company's own email (never the product's `getCrmEmailFrom` fallback), the address must not be on
 * the opt-out / bounce list (`customer_message_suppressions`) and the customer must not have turned messages off.
 */
export async function resolveInvoiceSender(admin: SupabaseClient, orgId: string, address: string): Promise<InvoiceSender> {
  if (!process.env.SMTP_HOST) return { ok: false, status: 503, error: 'Email is not set up for this company yet' }
  const { data: org } = await admin.from('orgs').select('id, name, address, phone, email, settings').eq('id', orgId).maybeSingle()
  if (!org) return { ok: false, status: 503, error: 'Email is not set up for this company yet' }
  const id = companyIdentity(org as Parameters<typeof companyIdentity>[0], null)
  if (id.missing.includes('missing_company_email') || id.missing.includes('missing_company_name')) {
    return { ok: false, status: 503, error: 'Add your company name and email in Settings → Company settings: invoices are sent from it and replies go to it.' }
  }
  const to = normalizeEmail(address)
  if (to && (await suppressionOf(admin, orgId, 'email', to))) return { ok: false, status: 409, error: 'This customer opted out of email or the address bounced, so the invoice was not sent. Send it another way.' }
  if (to) {
    const { data, error } = await orgDb(admin, orgId).from('customers').select('messages_off_at').ilike('email', to).not('messages_off_at', 'is', null).limit(1)
    if (!error && (data ?? []).length > 0) return { ok: false, status: 409, error: 'This customer turned off email, so the invoice was not sent. Send it another way.' }
    if (error && !isMissingColumn(error, 'messages_off_at')) throw new Error(`invoice email: ${error.message}`)
  }
  const name = id.from.name.replace(/["\\\r\n]/g, '')
  return { ok: true, from: /[^A-Za-z0-9 .'_-]/.test(name) ? `"${name}" <${id.from.address}>` : `${name} <${id.from.address}>`, replyTo: id.from.address }
}

export type SendInvoiceResult = { ok: true; invoice: JobInvoice } | { ok: false; status: 400 | 409 | 503; error: string }

/**
 * Email an invoice (a job's or not) to its customer (`to` defaults to the customer's email), then mark it sent. A draft is
 * issued (finalizeAndSendInvoice); an invoice already sent is simply sent again. Refuses a void or $0 invoice.
 * Email first, status second: a failed send never leaves an invoice marked "sent" that nobody received.
 */
export async function sendCustomerInvoice(
  admin: SupabaseClient,
  orgId: string,
  invoice: JobInvoice,
  to?: string | null,
  opts: { payUrl?: string | null } = {}
): Promise<SendInvoiceResult> {
  if (invoice.status === 'void') return { ok: false, status: 409, error: 'This invoice is void' }
  const doc = await loadInvoiceDocument(admin, orgId, invoice)
  const address = (to ?? doc.billTo.email ?? '').trim()
  if (!isUsableCustomerEmail(address)) return { ok: false, status: 400, error: 'This customer has no email address' }
  if (doc.items.length === 0 || invoice.total_cents <= 0) return { ok: false, status: 400, error: 'This invoice has nothing to bill' }
  const sender = await resolveInvoiceSender(admin, orgId, address)
  if (!sender.ok) return sender
  const mail = renderInvoiceEmail(doc, { payUrl: doc.isPaid ? null : opts.payUrl ?? null })
  await getMailTransport(orgId).sendMail({
    from: sender.from,
    to: address,
    replyTo: sender.replyTo,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  })
  if (invoice.status === 'draft') {
    return { ok: true, invoice: await finalizeAndSendInvoice(admin, invoice.id, address) }
  }
  // org-scope-ok: invoice was found in orgId by the caller (findOrgInvoice); job_invoices.org_id is set on every row (trigger, migration 202611100040)
  const { data, error } = await admin
    .from('job_invoices')
    .update({ sent_at: new Date().toISOString(), sent_to_email: address })
    .eq('id', invoice.id)
    .eq('org_id', orgId)
    .select()
    .single()
  if (error || !data) throw new Error(`Failed to record the send: ${error?.message ?? 'unknown'}`)
  return { ok: true, invoice: data as JobInvoice }
}

/**
 * Online payments: email any invoice (job or not) with its pay link — the office's "Email pay link". The same document
 * and wording as the invoice email; nothing about the invoice changes. Refuses a void / paid invoice or no email.
 */
export async function emailInvoicePayLink(
  admin: SupabaseClient,
  orgId: string,
  invoice: JobInvoice,
  payUrl: string,
  to?: string | null
): Promise<{ ok: true; to: string } | { ok: false; status: 400 | 409 | 503; error: string }> {
  if (invoice.status === 'void') return { ok: false, status: 409, error: 'This invoice is void' }
  const doc = await loadInvoiceDocument(admin, orgId, invoice)
  if (doc.isPaid) return { ok: false, status: 409, error: 'This invoice is already paid' }
  const address = (to ?? doc.billTo.email ?? '').trim()
  if (!isUsableCustomerEmail(address)) return { ok: false, status: 400, error: 'This customer has no email address' }
  const sender = await resolveInvoiceSender(admin, orgId, address)
  if (!sender.ok) return sender
  const mail = renderInvoiceEmail(doc, { payUrl })
  await getMailTransport(orgId).sendMail({
    from: sender.from,
    to: address,
    replyTo: sender.replyTo,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  })
  return { ok: true, to: address }
}
