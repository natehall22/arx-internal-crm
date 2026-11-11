/**
 * Emails about online payments that need a person: an automatic charge that failed, a bank payment that bounced, a
 * payment that could not be put on its invoice ("needs a look"), a dispute. The office list is the company's own
 * payment-email list (Admin → Email blasts → job payments); the customer email carries the company's brand only and a
 * fresh pay link. Successful payments need no extra email: job payments already send "Payment posted"
 * (recordJobPayment) and the invoice simply reads Paid. Never throws (a failed email must not fail a webhook).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getOrgEmailBlastSettings, resolveEmailBlastRecipients } from '@/lib/admin-email-blasts'
import { tryOrgAppUrl } from '@/lib/company-links'
import { escapeHtml } from '@/lib/html'
import { isUsableCustomerEmail, loadInvoiceDocument } from '@/lib/invoice-document'
import { formatCurrency } from '@/lib/job-payments'
import { createPaymentLink } from '@/lib/online-payments/links'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import type { JobInvoice } from '@/lib/types/invoices'
import { orgDb } from '@/lib/supabase/org-db'

export type PaymentProblem = 'autopay_failed' | 'bank_failed' | 'needs_review' | 'dispute'

const OFFICE_TITLES: Record<PaymentProblem, string> = {
  autopay_failed: 'Automatic payment failed',
  bank_failed: 'Bank payment failed',
  needs_review: 'Online payment needs a look',
  dispute: 'Card payment disputed',
}

function mailReady(): boolean {
  return !!process.env.SMTP_HOST && !!getCrmEmailFrom()
}

async function loadInvoice(admin: SupabaseClient, orgId: string, invoiceId: string): Promise<JobInvoice | null> {
  // job_invoices.org_id is set on every invoice once 202611100040 is applied (required before this feature's migration).
  const { data } = await orgDb(admin, orgId).from('job_invoices').select('*').eq('id', invoiceId).maybeSingle()
  return (data as JobInvoice | null) ?? null
}

export async function notifyOfficeOfPaymentProblem(
  admin: SupabaseClient,
  orgId: string,
  p: { problem: PaymentProblem; invoiceId: string; amountCents: number; detail: string; nextTry?: Date | null }
): Promise<void> {
  try {
    if (!mailReady()) return
    const { data: org } = await admin.from('orgs').select('settings').eq('id', orgId).maybeSingle()
    const { emails } = await resolveEmailBlastRecipients(admin, { orgId, blastType: 'job_payment', settings: getOrgEmailBlastSettings((org as { settings?: unknown } | null)?.settings) })
    if (emails.length === 0) return
    const inv = await loadInvoice(admin, orgId, p.invoiceId)
    const number = inv?.invoice_number ?? 'an invoice'
    const base = await tryOrgAppUrl(orgId, 'online payment notice')
    const link = base ? (inv?.job_id ? `${base}/ops/jobs/${inv.job_id}` : inv?.customer_id ? `${base}/c/${inv.customer_id}` : null) : null
    const title = OFFICE_TITLES[p.problem]
    const lines = [
      `${title}: ${number}, ${formatCurrency(p.amountCents)}.`,
      p.detail,
      p.nextTry ? `We'll try the card again on ${p.nextTry.toISOString().slice(0, 10)}.` : '',
    ].filter(Boolean)
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#111827;">
  <h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(title)}</h2>
  ${lines.map((l) => `<p style="font-size:14px;margin:0 0 8px;">${escapeHtml(l)}</p>`).join('')}
  ${link ? `<p style="margin-top:16px;"><a href="${escapeHtml(link)}" style="color:#1d4ed8;">Open in the CRM</a></p>` : ''}
</div>`
    const transport = getMailTransport()
    for (const to of emails) {
      await transport.sendMail({ from: getCrmEmailFrom(), to, subject: `${title}: ${number}`, html, text: lines.join('\n') }).catch((e: unknown) => console.error('notifyOfficeOfPaymentProblem: send failed', to, e))
    }
  } catch (e) {
    console.error('notifyOfficeOfPaymentProblem failed', e)
  }
}

/** The customer's card / bank payment did not go through: tell them, with a fresh pay link. */
export async function notifyCustomerOfFailedPayment(
  admin: SupabaseClient,
  orgId: string,
  p: { invoiceId: string; kind: 'autopay' | 'bank'; nextTry?: Date | null }
): Promise<void> {
  try {
    if (!mailReady()) return
    const inv = await loadInvoice(admin, orgId, p.invoiceId)
    if (!inv || inv.status === 'void' || inv.status === 'paid') return
    const doc = await loadInvoiceDocument(admin, orgId, inv)
    if (!isUsableCustomerEmail(doc.billTo.email) || doc.balanceCents <= 0) return
    const link = await createPaymentLink(admin, orgId, { kind: 'invoice', invoiceId: inv.id }, null)
    const company = doc.company.legalName || 'us'
    const what = p.kind === 'autopay' ? 'the automatic payment on your card on file' : 'your bank payment'
    const lines = [
      `Hi ${doc.billTo.name},`,
      `${what.charAt(0).toUpperCase()}${what.slice(1)} for invoice ${inv.invoice_number} (${formatCurrency(doc.balanceCents)}) didn't go through.`,
      p.nextTry ? `We'll try your card again on ${p.nextTry.toISOString().slice(0, 10)}, or you can pay now with the link below.` : 'You can pay with the link below.',
    ]
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#111827;">
  <div style="font-size:18px;font-weight:700;margin-bottom:12px;">${escapeHtml(company)}</div>
  ${lines.map((l) => `<p style="font-size:15px;margin:0 0 10px;">${escapeHtml(l)}</p>`).join('')}
  <p style="margin:20px 0;"><a href="${escapeHtml(link.url)}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Pay ${escapeHtml(formatCurrency(doc.balanceCents))}</a></p>
  <p style="font-size:14px;color:#374151;">Questions? Reply to this email${doc.company.phone ? ` or call ${escapeHtml(doc.company.phone)}` : ''}.</p>
</div>`
    await getMailTransport().sendMail({
      from: getCrmEmailFrom(),
      to: doc.billTo.email as string,
      ...(doc.company.email ? { replyTo: doc.company.email } : {}),
      subject: `Payment didn't go through — invoice ${inv.invoice_number}`,
      html,
      text: [...lines, '', `Pay online: ${link.url}`].join('\n'),
    })
  } catch (e) {
    console.error('notifyCustomerOfFailedPayment failed', e)
  }
}
