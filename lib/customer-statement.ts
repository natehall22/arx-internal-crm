/**
 * A customer's statement: what they owe right now (open invoices, oldest due first, with how late) and what they paid
 * lately (payments applied to their invoices, last 90 days). Printable (/customers/[id]/statement) and emailable
 * (POST /api/customers/[id]/statement). Nothing here is a new rule: the invoices and what is owed come from
 * loadAllInvoices (the same answer as the unpaid list), the layout is the company's customer email, the sender rules are
 * the invoice email's. A statement is a document the office sends BY HAND, so it carries no unsubscribe link, but a customer on the
 * opt-out / bounce list, or who turned messages off, is still never emailed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { renderCustomerEmail, type EmailCompany } from '@/lib/customer-email-layout'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { isUsableCustomerEmail } from '@/lib/invoice-document'
import { resolveInvoiceSender } from '@/lib/invoice-email'
import { invoiceItemDateLabel } from '@/lib/invoice-lines'
import { formatCurrency } from '@/lib/job-payments'
import { methodLabel } from '@/lib/payment-receipt'
import { addDaysYmd, ymdInZone } from '@/lib/service-plans'
import { chunks, loadAllInvoices, type InvoiceListRow } from '@/lib/service-billing-db'
import { getMailTransport } from '@/lib/setter-email'
import { orgDb } from '@/lib/supabase/org-db'

export const STATEMENT_PAYMENT_DAYS = 90

export type StatementPayment = { paidAt: string; amountCents: number; method: string; invoiceNumber: string }

export type CustomerStatement = {
  asOf: string
  customer: { id: string; name: string; email: string | null; address: string | null }
  open: InvoiceListRow[]
  payments: StatementPayment[]
  owedCents: number
  overdueCents: number
}

/** Pure: totals for a statement's open invoices (overdue = a balance past its due day). */
export function statementTotals(open: ReadonlyArray<Pick<InvoiceListRow, 'balanceCents' | 'daysOverdue'>>): { owedCents: number; overdueCents: number } {
  return {
    owedCents: open.reduce((s, r) => s + r.balanceCents, 0),
    overdueCents: open.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.balanceCents, 0),
  }
}

export async function loadCustomerStatement(admin: SupabaseClient, orgId: string, customerId: string): Promise<CustomerStatement | null> {
  const { data: customer } = await orgDb(admin, orgId).from('customers').select('id, name, email, address_text').eq('id', customerId).maybeSingle()
  if (!customer) return null
  const c = customer as { id: string; name: string | null; email: string | null; address_text: string | null }
  const asOf = ymdInZone(new Date(), await loadOrgTimeZone(admin, orgId))
  const loaded = await loadAllInvoices(admin, orgId, { today: asOf, customerId })
  const all = loaded?.rows ?? []
  const open = all
    .filter((r) => r.balanceCents > 0)
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.createdAt.localeCompare(b.createdAt))
  const numberOf = new Map(all.map((r) => [r.id, r.invoiceNumber]))
  const since = addDaysYmd(asOf, -STATEMENT_PAYMENT_DAYS)
  const payments: StatementPayment[] = []
  for (const ids of chunks(all.filter((r) => r.status !== 'void' && r.status !== 'draft').map((r) => r.id))) {
    // invoice_payments / job_payments carry no company filter of their own: the ids are this customer's invoices, just loaded company-scoped.
    const { data: apps, error } = await admin.from('invoice_payments').select('invoice_id, job_payment_id, applied_cents').in('invoice_id', ids)
    if (error) throw new Error(`statement: read payments: ${error.message}`)
    const rows = (apps ?? []) as Array<{ invoice_id: string; job_payment_id: string; applied_cents: number }>
    const payIds = Array.from(new Set(rows.map((a) => a.job_payment_id)))
    const dates = new Map<string, { paid_at: string; method: string }>()
    for (const part of chunks(payIds)) {
      // org-scope-ok: payment ids come from this customer's invoice applications, loaded company-scoped above
      const { data: pays, error: payError } = await admin.from('job_payments').select('id, paid_at, method').in('id', part)
      if (payError) throw new Error(`statement: read payment days: ${payError.message}`)
      for (const p of (pays ?? []) as Array<{ id: string; paid_at: string; method: string }>) dates.set(p.id, p)
    }
    for (const a of rows) {
      const p = dates.get(a.job_payment_id)
      const day = p?.paid_at ? String(p.paid_at).slice(0, 10) : null
      if (day && day >= since && a.applied_cents > 0) payments.push({ paidAt: day, amountCents: a.applied_cents, method: p?.method ?? '', invoiceNumber: numberOf.get(a.invoice_id) ?? '' })
    }
  }
  payments.sort((x, y) => y.paidAt.localeCompare(x.paidAt))
  return { asOf, customer: { id: c.id, name: c.name || 'Customer', email: isUsableCustomerEmail(c.email) ? (c.email as string).trim() : null, address: c.address_text }, open, payments, ...statementTotals(open) }
}

/** Pure: the statement email. */
export function renderStatementEmail(company: EmailCompany, s: CustomerStatement): { subject: string; html: string; text: string } {
  const lines = s.open.map((r) => ({
    label: `Invoice ${r.invoiceNumber}`,
    value: `${formatCurrency(r.balanceCents)}${r.dueAt ? ` · due ${invoiceItemDateLabel(r.dueAt)}` : ''}${r.daysOverdue > 0 ? ` (${r.daysOverdue} day${r.daysOverdue === 1 ? '' : 's'} late)` : ''}`,
  }))
  const first = s.customer.name.split(/\s+/)[0]
  const { html, text } = renderCustomerEmail({
    company,
    preheader: s.owedCents > 0 ? `You have ${formatCurrency(s.owedCents)} outstanding.` : 'Your account is paid up.',
    heading: `Statement — ${invoiceItemDateLabel(s.asOf)}`,
    paragraphs: s.owedCents > 0
      ? [`Hi ${first}, here is what is open on your account: ${formatCurrency(s.owedCents)} in total${s.overdueCents > 0 ? `, ${formatCurrency(s.overdueCents)} of it past due` : ''}.`]
      : [`Hi ${first}, your account is paid up — nothing is owed. Thank you.`],
    rows: lines,
    footnote: company.phone ? `Questions about your account? Reply to this email or call ${company.phone}.` : 'Questions about your account? Just reply to this email.',
    unsubscribeUrl: null,
  })
  return { subject: `Account statement${company.name ? ` from ${company.name}` : ''}`, html, text }
}

export type SendStatementResult = { ok: true; to: string } | { ok: false; status: 400 | 409 | 502 | 503; error: string }

export async function emailCustomerStatement(admin: SupabaseClient, orgId: string, s: CustomerStatement): Promise<SendStatementResult> {
  if (!s.customer.email) return { ok: false, status: 400, error: 'This customer has no email address' }
  const sender = await resolveInvoiceSender(admin, orgId, s.customer.email)
  if (!sender.ok) return sender
  const mail = renderStatementEmail(sender.company, s)
  try {
    await getMailTransport(orgId).sendMail({ from: sender.from, to: s.customer.email, replyTo: sender.replyTo, subject: mail.subject, html: mail.html, text: mail.text })
  } catch (e) {
    console.error('statement email failed', e)
    return { ok: false, status: 502, error: 'The statement could not be sent. Check the email settings and try again.' }
  }
  return { ok: true, to: s.customer.email }
}
