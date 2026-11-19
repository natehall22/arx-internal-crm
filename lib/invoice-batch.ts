/**
 * MASTER INVOICE (a "batch") — the pure rules, client-safe. A batch is ONE document over several of a customer's job
 * invoices (builders: one invoice for the week's finished houses). It holds NO money: every job keeps its own invoice, so
 * paid-in-full (lib/job-collection.ts), payroll eligibility, commission, job profit and QuickBooks read per-job rows exactly
 * as before. What the batch adds is presentation (this document, one email, one portal page) and a payment split (one
 * payment divided over the job invoices by the existing writers; lib/invoice-batch-db.ts).
 */
import { escapeHtml } from '@/lib/html'
import { formatCurrency } from '@/lib/job-payments'
import { invoiceItemDateLabel } from '@/lib/invoice-lines'
import { allocateCollection } from '@/lib/visit-collections'

/** The most jobs one master invoice takes (keeps the document, the email and the payment split small). */
export const MAX_BATCH_JOBS = 50

/** "B-0003". */
export function batchNumberFor(seq: number): string {
  return `B-${String(Math.max(1, Math.floor(seq))).padStart(4, '0')}`
}

/** The number after the highest "B-nnnn" already used (a company's own numbers only). */
export function nextBatchSeq(existing: ReadonlyArray<string>): number {
  let max = 0
  for (const n of existing) {
    const m = /^B-(\d+)$/.exec(n)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/** One house on the master invoice. `rollCount` is an optional seam: shown only when a loader supplies it. */
export type BatchLine = {
  invoiceId: string
  invoiceNumber: string
  jobId: string
  jobNumber: string
  address: string
  /** properties.lot / properties.community when those columns exist (feat/precision-lots); null otherwise. */
  lot: string | null
  community: string | null
  customerPo: string | null
  /** The job invoice's total (sales tax included): what this house owes on the master invoice. */
  amountCents: number
  paidCents: number
  rollCount?: number | null
}

/** "12 rolls" — only when there is more than one (one roll says nothing); '' otherwise. */
export function rollLabel(n: number | null | undefined): string {
  return typeof n === 'number' && n > 1 ? `${n} rolls` : ''
}

/** The development named in the header: only when every house (that has one) is in the SAME development. */
export function batchDevelopment(lines: ReadonlyArray<Pick<BatchLine, 'community'>>): string | null {
  const names = Array.from(new Set(lines.map((l) => (l.community ?? '').trim()).filter(Boolean)))
  const everyHouseHasOne = lines.every((l) => (l.community ?? '').trim())
  return names.length === 1 && everyHouseHasOne ? names[0] : null
}

/** "Lot 14 · 220 Oak Ln" — the lot first (it is what a builder reads), then the address. */
export function batchLineWhere(l: Pick<BatchLine, 'lot' | 'address' | 'community'>, showCommunity: boolean): string {
  const lot = (l.lot ?? '').trim()
  return [showCommunity ? (l.community ?? '').trim() : '', lot ? `Lot ${lot.replace(/^lot\s*/i, '')}` : '', (l.address ?? '').trim()].filter(Boolean).join(' · ')
}

export function batchTotals(lines: ReadonlyArray<Pick<BatchLine, 'amountCents' | 'paidCents'>>): { totalCents: number; paidCents: number; balanceCents: number } {
  const totalCents = lines.reduce((s, l) => s + l.amountCents, 0)
  const paidCents = lines.reduce((s, l) => s + Math.min(l.paidCents, l.amountCents), 0)
  return { totalCents, paidCents, balanceCents: totalCents - paidCents }
}

/** Pure: one payment over the batch's job invoices, oldest first (the order given), never more than each owes. */
export function splitBatchPayment(amountCents: number, invoices: Array<{ id: string; balanceCents: number }>): { parts: Array<{ invoiceId: string; cents: number }>; leftoverCents: number } {
  return allocateCollection(amountCents, invoices.map((i) => ({ id: i.id, number: '', balanceCents: i.balanceCents, jobId: null })))
}

export type BatchDocument = {
  batch: { id: string; number: string; sentAt: string | null; sentToEmail: string | null; publicNote: string | null; createdAt: string }
  lines: BatchLine[]
  totalCents: number
  paidCents: number
  balanceCents: number
  development: string | null
  /** Sales tax already inside the line amounts (sum of the job invoices' tax). */
  taxCents: number
  /** Latest due day among the houses (the master invoice is due when the last one is). */
  dueAt: string | null
  /** Every house's invoice is issued (nothing left as a draft). */
  issued: boolean
  billTo: { name: string; email: string | null }
  company: { legalName: string; address: string; phone: string; email: string }
}

const money = formatCurrency

/** Pure: the master invoice email (subject, HTML, plain text). `portalUrl` = the one portal page for the whole thing. */
export function renderBatchEmail(doc: BatchDocument, opts: { portalUrl?: string | null } = {}): { subject: string; html: string; text: string } {
  const { company, billTo } = doc
  const showCommunity = !doc.development
  const subject = `Invoice ${doc.batch.number}${doc.development ? ` — ${doc.development}` : ''}${company.legalName ? ` from ${company.legalName}` : ''}`
  const td = 'padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;'
  const tdr = `${td}text-align:right;white-space:nowrap;`
  const rows = doc.lines
    .map((l) => {
      const sub = [`Job ${l.jobNumber}`, l.customerPo ? `PO ${l.customerPo}` : '', rollLabel(l.rollCount)].filter(Boolean).join(' · ')
      return `<tr><td style="${td}">${escapeHtml(batchLineWhere(l, showCommunity) || `Job ${l.jobNumber}`)}<div style="font-size:12px;color:#4b5563;">${escapeHtml(sub)}</div></td><td style="${tdr}">${escapeHtml(money(l.amountCents))}</td></tr>`
    })
    .join('')
  const total = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:6px 8px;font-size:14px;color:#111827;${strong ? 'font-weight:700;' : ''}">${escapeHtml(label)}</td><td style="padding:6px 8px;font-size:14px;color:#111827;text-align:right;${strong ? 'font-weight:700;' : ''}">${escapeHtml(value)}</td></tr>`
  const totals = [
    ...(doc.taxCents > 0 ? [total('Includes sales tax', money(doc.taxCents))] : []),
    total('Total', money(doc.totalCents), true),
    ...(doc.paidCents > 0 ? [total('Paid', `(${money(doc.paidCents)})`)] : []),
    total('Balance due', doc.balanceCents <= 0 ? 'Paid — thank you' : money(doc.balanceCents), true),
  ].join('')
  const contact = [company.phone, company.email].filter(Boolean).map((v) => escapeHtml(v)).join(' · ')
  const portal = opts.portalUrl ? `<p style="margin:20px 0;"><a href="${escapeHtml(opts.portalUrl)}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;">View this invoice online</a></p>` : ''
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#111827;">
  <div style="font-size:20px;font-weight:700;">${escapeHtml(company.legalName)}</div>
  ${company.address ? `<div style="font-size:13px;color:#374151;white-space:pre-line;">${escapeHtml(company.address)}</div>` : ''}
  ${contact ? `<div style="font-size:13px;color:#374151;">${contact}</div>` : ''}
  <h1 style="font-size:22px;margin:24px 0 4px;">Invoice ${escapeHtml(doc.batch.number)}</h1>
  <div style="font-size:14px;color:#374151;">${escapeHtml(billTo.name)}${doc.development ? ` · ${escapeHtml(doc.development)}` : ''}</div>
  <div style="font-size:14px;color:#374151;margin-bottom:16px;">${doc.lines.length} job${doc.lines.length === 1 ? '' : 's'}${doc.dueAt ? ` · due ${escapeHtml(invoiceItemDateLabel(doc.dueAt))}` : ''}</div>
  ${portal}
  <table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 16px;">
    <tr><th style="text-align:left;padding:8px;font-size:12px;color:#374151;border-bottom:2px solid #111827;">House</th><th style="text-align:right;padding:8px;font-size:12px;color:#374151;border-bottom:2px solid #111827;">Amount</th></tr>
    ${rows}
  </table>
  <table role="presentation" style="width:100%;max-width:320px;margin-left:auto;border-collapse:collapse;">${totals}</table>
  ${doc.batch.publicNote ? `<p style="font-size:14px;color:#111827;white-space:pre-line;margin-top:20px;">${escapeHtml(doc.batch.publicNote)}</p>` : ''}
  <p style="font-size:14px;color:#374151;margin-top:24px;">Questions about this invoice? Reply to this email${company.phone ? ` or call ${escapeHtml(company.phone)}` : ''}.</p>
</div>`
  const text = [
    company.legalName,
    `Invoice ${doc.batch.number}${doc.development ? ` — ${doc.development}` : ''}`,
    billTo.name,
    '',
    ...doc.lines.map((l) => `${batchLineWhere(l, showCommunity) || `Job ${l.jobNumber}`} (job ${l.jobNumber}${l.customerPo ? `, PO ${l.customerPo}` : ''}${rollLabel(l.rollCount) ? `, ${rollLabel(l.rollCount)}` : ''}): ${money(l.amountCents)}`),
    '',
    `Total ${money(doc.totalCents)}`,
    `Balance due ${doc.balanceCents <= 0 ? 'Paid — thank you' : money(doc.balanceCents)}`,
    ...(opts.portalUrl ? ['', `View online: ${opts.portalUrl}`] : []),
    ...(doc.batch.publicNote ? ['', doc.batch.publicNote] : []),
    '',
    `Questions? Reply to this email${company.phone ? ` or call ${company.phone}` : ''}.`,
  ].join('\n')
  return { subject, html, text }
}

/** The ONE reading of a typed PO number (job and invoice): trimmed, blank = none, up to 60 characters. */
export function normalizeCustomerPo(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v == null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'PO number must be text' }
  const t = v.trim().replace(/\s+/g, ' ')
  if (t.length > 60) return { ok: false, error: 'PO number is too long (60 characters at most)' }
  return { ok: true, value: t || null }
}

/** The developments among the jobs on offer, with how many houses each has (empty when none has one: no filter is shown). */
export function developmentOptions(jobs: ReadonlyArray<{ community: string | null }>): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const j of jobs) {
    const c = (j.community ?? '').trim()
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
}

/** '' = all developments; otherwise only that one's houses. */
export function filterByDevelopment<T extends { community: string | null }>(jobs: readonly T[], development: string): T[] {
  return development ? jobs.filter((j) => (j.community ?? '').trim() === development) : [...jobs]
}
