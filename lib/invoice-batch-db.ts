/**
 * MASTER INVOICE (batch), server side — rules in lib/invoice-batch.ts. A batch is a group over one customer's JOB invoices:
 *
 *  - Creating it makes (or reuses a draft of) each job's own final invoice through createFinalInvoice — the same writer as
 *    "Final invoice" on the job — then links them (`job_invoices.batch_id`). No invoice without a job ever holds job money.
 *  - Sending it emails ONE document, then issues each draft member through finalizeAndSendInvoice (which queues each job
 *    invoice for QuickBooks as it always has). Nothing here enqueues: the batch is presentation, not a ledger entry.
 *  - A payment on it is split over the member invoices oldest first and written through the existing per-invoice payment
 *    writer (`payPart` → recordJobInvoicePayment: job payment, outbox, paid-in-full, commission sync, locked apply), one
 *    idempotency key per member invoice, then ONE receipt. A retry with the same `clientKey` finishes the split.
 *  - Before migration 202611300180 every read here answers "none" and every write refuses with 503.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { tryOrgAppUrl } from '@/lib/company-links'
import { computeInvoiceBalance, createCustomAmountInvoice, finalizeAndSendInvoice, issueDatesFor, updateInvoiceItem, voidInvoice, type CustomerPaymentMethod, CUSTOMER_PAYMENT_METHODS } from '@/lib/invoices'
import { evaluateJobCollection } from '@/lib/job-collection'
import { formatCurrency } from '@/lib/job-payments'
import { invoicePaidCents } from '@/lib/invoice-lines'
import { isUsableCustomerEmail, loadInvoiceDocument } from '@/lib/invoice-document'
import { resolveInvoiceSender } from '@/lib/invoice-email'
import { batchDevelopment, batchNumberFor, batchTotals, MAX_BATCH_JOBS, nextBatchSeq, renderBatchEmail, splitBatchPayment, type BatchDocument, type BatchLine } from '@/lib/invoice-batch'
import { sendPaymentReceipt } from '@/lib/payment-receipt'
import { getMailTransport } from '@/lib/setter-email'
import { isMissingColumn, isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { loadAppliedCents } from '@/lib/service-billing-db'
export { loadBatchNumbers } from '@/lib/service-billing-db'
import { ymdInZone } from '@/lib/service-plans'
import { payPart } from '@/lib/visit-collections-db'
import type { JobInvoice } from '@/lib/types/invoices'

type Err = { ok: false; status: 400 | 404 | 409 | 500 | 503; error: string }
const NOT_SET_UP: Err = { ok: false, status: 503, error: 'Master invoices are not set up yet.' }

const asRows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : [])

/** One finished house a master invoice can bill. `amountCents` is what will really be billed: the job's collection rule (sale minus collected). */
export type BillableJob = {
  jobId: string
  jobNumber: string
  address: string
  lot: string | null
  community: string | null
  customerPo: string | null
  /** lib/job-collection.ts remaining (sale amount − payments in hand). Jobs already paid in full are never listed. */
  amountCents: number
  completedAt: string | null
  /** A draft job invoice already exists (the batch reuses it instead of making a second)... */
  draftInvoiceId: string | null
  /** ...and what that draft says before tax; when it differs from `amountCents` the office is asked to "Use" the real amount. */
  draftCents: number | null
}

/** Soft read of properties.community / .lot (feat/precision-lots): absent columns = no development filter, never an error. */
async function loadDevelopments(admin: SupabaseClient, orgId: string, propertyIds: string[]): Promise<{ available: boolean; byProperty: Map<string, { community: string | null; lot: string | null }> }> {
  const byProperty = new Map<string, { community: string | null; lot: string | null }>()
  if (propertyIds.length === 0) return { available: false, byProperty }
  const { data, error } = await orgDb(admin, orgId).from('properties').select('id, community, lot').in('id', propertyIds)
  if (error) return { available: false, byProperty }
  for (const r of asRows<{ id: string; community?: string | null; lot?: string | null }>(data)) byProperty.set(r.id, { community: r.community?.trim() || null, lot: r.lot?.trim() || null })
  return { available: true, byProperty }
}

/**
 * The customer's finished (status 'complete'), not-yet-billed fixed-price jobs, in a fixed number of queries (no per-job reads).
 * What each would bill is the ONE collection rule (evaluateJobCollection: sale amount minus payments in hand); a job already
 * paid in full is left out. Billed = a live job invoice other than a deposit (a draft not yet in a master invoice does not
 * count: it is reused). Time & materials jobs are billed from Hours to bill.
 * `developmentsAvailable` = the properties columns exist (the screen offers the development filter only then).
 */
export async function loadBillableJobs(admin: SupabaseClient, orgId: string, customerId: string): Promise<{ jobs: BillableJob[]; developmentsAvailable: boolean }> {
  const db = orgDb(admin, orgId)
  const cols = 'id, job_number, address_text, sale_amount, completed_at, property_id, billing_mode, allow_close_with_balance, close_balance_by'
  let jobsRes = await db.from('production_jobs').select(`${cols}, customer_po`).eq('customer_id', customerId).eq('status', 'complete').limit(500)
  if (isMissingColumn(jobsRes.error, 'customer_po')) jobsRes = await db.from('production_jobs').select(cols).eq('customer_id', customerId).eq('status', 'complete').limit(500)
  if (jobsRes.error) throw new Error(`master invoice: read jobs: ${jobsRes.error.message}`)
  const jobs = asRows<{ id: string; job_number: string; address_text: string | null; sale_amount: number | null; customer_po?: string | null; completed_at: string | null; property_id: string | null; billing_mode?: string | null; allow_close_with_balance: boolean | null; close_balance_by: string | null }>(jobsRes.data).filter((j) => j.billing_mode !== 'time_materials')
  if (jobs.length === 0) return { jobs: [], developmentsAvailable: false }
  const ids = jobs.map((j) => j.id)
  const { data: invs, error: invErr } = await db.from('job_invoices').select('id, job_id, status, invoice_kind, batch_id, subtotal_cents').in('job_id', ids).neq('status', 'void')
  if (invErr) throw new Error(`master invoice: read invoices: ${invErr.message}`)
  const live = asRows<{ id: string; job_id: string; status: string; invoice_kind: string; batch_id?: string | null; subtotal_cents: number | null }>(invs).filter((i) => i.invoice_kind !== 'deposit')
  const blocked = new Set<string>()
  const draftOf = new Map<string, { id: string; cents: number }>()
  for (const i of live) {
    if (i.status === 'draft' && !i.batch_id && !draftOf.has(i.job_id)) draftOf.set(i.job_id, { id: i.id, cents: i.subtotal_cents ?? 0 })
    else blocked.add(i.job_id)
  }
  const open = jobs.filter((j) => !blocked.has(j.id))
  if (open.length === 0) return { jobs: [], developmentsAvailable: false }
  const openIds = open.map((j) => j.id)
  // org-scope-ok: job_payments has no org_id for job payments; the job ids were just read company-scoped (orgDb above)
  const { data: pays, error: payErr } = await admin.from('job_payments').select('job_id, amount_cents, funding_status').in('job_id', openIds)
  if (payErr) throw new Error(`master invoice: read payments: ${payErr.message}`)
  const paysByJob = new Map<string, Array<{ amount_cents: number; funding_status: string | null }>>()
  for (const p of asRows<{ job_id: string; amount_cents: number; funding_status: string | null }>(pays)) paysByJob.set(p.job_id, [...(paysByJob.get(p.job_id) ?? []), p])
  const dev = await loadDevelopments(admin, orgId, Array.from(new Set(open.map((j) => j.property_id).filter((x): x is string => !!x))))
  const out: BillableJob[] = []
  for (const j of open) {
    const c = evaluateJobCollection({ saleAmount: j.sale_amount, payments: paysByJob.get(j.id) ?? [], allowCloseWithBalance: j.allow_close_with_balance, closeBalanceBy: j.close_balance_by })
    if (c.missingSaleAmount || c.paidInFull || c.remainingCents <= 0) continue
    const d = j.property_id ? dev.byProperty.get(j.property_id) : undefined
    const draft = draftOf.get(j.id)
    out.push({ jobId: j.id, jobNumber: j.job_number, address: j.address_text ?? '', lot: d?.lot ?? null, community: d?.community ?? null, customerPo: j.customer_po?.trim() || null, amountCents: c.remainingCents, completedAt: j.completed_at, draftInvoiceId: draft?.id ?? null, draftCents: draft ? draft.cents : null })
  }
  out.sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.jobNumber.localeCompare(b.jobNumber))
  return { jobs: out, developmentsAvailable: dev.available }
}

export type DraftMismatch = { jobId: string; jobNumber: string; draftCents: number; billableCents: number }
export type CreateBatchResult = { ok: true; batchId: string; number: string } | (Err & { code?: 'draft_differs'; drafts?: DraftMismatch[] })

/**
 * "Bill finished jobs": one master invoice over the chosen jobs (each must still be billable), at each job's real remaining
 * amount. A house with a draft invoice that says a DIFFERENT amount is refused (409, code 'draft_differs') unless its job id is
 * in `useBillable` ("Use $X"): then that draft's single line is set to the real amount. Drafts only; nothing is sent.
 * Claim: linking is conditional (`batch_id IS NULL`) and a job can hold only one live link (unique index), so two calls racing
 * for the same house cannot both win; the loser rolls back what it made and answers 409.
 */
export async function createInvoiceBatch(admin: SupabaseClient, orgId: string, userId: string, input: { customerId: string; jobIds: string[]; publicNote?: string | null; useBillable?: string[] }): Promise<CreateBatchResult> {
  const jobIds = Array.from(new Set(input.jobIds))
  if (jobIds.length === 0) return { ok: false, status: 400, error: 'Pick at least one job.' }
  if (jobIds.length > MAX_BATCH_JOBS) return { ok: false, status: 400, error: `A master invoice holds up to ${MAX_BATCH_JOBS} jobs.` }
  const db = orgDb(admin, orgId)
  const probe = await db.from('invoice_batches').select('id', { head: true, count: 'exact' }).limit(1)
  if (probe.error) {
    if (isMissingTable(probe.error)) return NOT_SET_UP
    throw new Error(`master invoice: ${probe.error.message}`)
  }
  const { jobs } = await loadBillableJobs(admin, orgId, input.customerId)
  const byId = new Map(jobs.map((j) => [j.jobId, j]))
  const picked = jobIds.map((id) => byId.get(id))
  if (picked.some((j) => !j)) return { ok: false, status: 409, error: 'One of those jobs is already billed, paid, or not finished. Refresh the list.' }
  const chosen = picked as BillableJob[]

  // A draft that disagrees with what is really owed: ask before anything is made or changed.
  const use = new Set(input.useBillable ?? [])
  const drafts = chosen.filter((j) => j.draftInvoiceId && j.draftCents !== j.amountCents && !use.has(j.jobId)).map((j) => ({ jobId: j.jobId, jobNumber: j.jobNumber, draftCents: j.draftCents ?? 0, billableCents: j.amountCents }))
  if (drafts.length > 0) {
    const first = drafts[0]
    return { ok: false, status: 409, code: 'draft_differs', drafts, error: `Job ${first.jobNumber}'s draft invoice says ${formatCurrency(first.draftCents)} but ${formatCurrency(first.billableCents)} is still owed${drafts.length > 1 ? ` (and ${drafts.length - 1} more differ)` : ''}. Use the amount owed?` }
  }

  const invoiceIds: string[] = []
  const madeHere: string[] = []
  for (const j of chosen) {
    if (j.draftInvoiceId) {
      if (j.draftCents !== j.amountCents) {
        const { data: items } = await db.from('job_invoice_items').select('id').eq('invoice_id', j.draftInvoiceId)
        const rows = asRows<{ id: string }>(items)
        if (rows.length !== 1) return { ok: false, status: 409, error: `Job ${j.jobNumber}'s draft invoice has ${rows.length} lines, so it cannot be set to ${formatCurrency(j.amountCents)} automatically. Fix that invoice, then bill again.` }
        try {
          await updateInvoiceItem(admin, j.draftInvoiceId, rows[0].id, { qty: 1, unit_price_cents: j.amountCents })
        } catch (e) {
          return { ok: false, status: 409, error: `Could not update job ${j.jobNumber}'s draft: ${(e as Error).message}` }
        }
      }
      invoiceIds.push(j.draftInvoiceId)
      continue
    }
    try {
      const inv = await createCustomAmountInvoice(admin, j.jobId, userId, j.amountCents)
      invoiceIds.push(inv.id)
      madeHere.push(inv.id)
    } catch (e) {
      // Invoices already made stay as drafts: a retry reuses them (loadBillableJobs lists them with draftInvoiceId).
      return { ok: false, status: 409, error: `Could not bill job ${j.jobNumber}: ${(e as Error).message}` }
    }
  }

  const undo = async (batchId: string | null) => {
    if (batchId) {
      await db.from('job_invoices').update({ batch_id: null }).eq('batch_id', batchId)
      await db.from('invoice_batches').delete().eq('id', batchId)
    }
    for (const id of madeHere) await voidInvoice(admin, id, 'Duplicate master invoice attempt').catch(() => null)
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: nums } = await db.from('invoice_batches').select('batch_number')
    const number = batchNumberFor(nextBatchSeq(asRows<{ batch_number: string }>(nums).map((r) => r.batch_number)))
    const { data: row, error } = await db.from('invoice_batches').insert({ customer_id: input.customerId, batch_number: number, public_note: input.publicNote?.trim().slice(0, 1000) || null, created_by: userId }).select('id').single()
    if (error) {
      if (error.code === '23505') continue // two people numbering at once: take the next number
      throw new Error(`master invoice: create: ${error.message}`)
    }
    const batchId = String((row as { id: string }).id)
    const { data: linked, error: linkErr } = await db.from('job_invoices').update({ batch_id: batchId }).in('id', invoiceIds).is('batch_id', null).select('id')
    if (linkErr || asRows<{ id: string }>(linked).length !== invoiceIds.length) {
      await undo(batchId)
      return linkErr && linkErr.code !== '23505'
        ? { ok: false, status: 500, error: 'Could not group the invoices. Try again.' }
        : { ok: false, status: 409, error: 'Another master invoice just took one of those houses. Refresh the list.' }
    }
    return { ok: true, batchId, number }
  }
  await undo(null)
  return { ok: false, status: 409, error: 'Could not number the master invoice. Try again.' }
}

type BatchRow = { id: string; customer_id: string; batch_number: string; public_note: string | null; sent_at: string | null; sent_to_email: string | null; created_at: string }

export async function findBatch(admin: SupabaseClient, orgId: string, batchId: string): Promise<BatchRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) return null
  const { data, error } = await orgDb(admin, orgId).from('invoice_batches').select('*').eq('id', batchId).maybeSingle()
  return error ? null : ((data as BatchRow | null) ?? null)
}

/** The live (non-void) member invoices, oldest first. */
async function memberInvoices(admin: SupabaseClient, orgId: string, batchId: string): Promise<JobInvoice[]> {
  const { data, error } = await orgDb(admin, orgId).from('job_invoices').select('*').eq('batch_id', batchId).neq('status', 'void').order('created_at', { ascending: true }).order('id')
  if (error) throw new Error(`master invoice: read members: ${error.message}`)
  return asRows<JobInvoice>(data)
}

/** The whole document. `opts.rollCounts` (job id → rolls) is the seam for a roll-count loader: shown on a line only when present. */
export async function loadBatchDocument(admin: SupabaseClient, orgId: string, batch: BatchRow, opts: { rollCounts?: ReadonlyMap<string, number> } = {}): Promise<BatchDocument | null> {
  const invoices = await memberInvoices(admin, orgId, batch.id)
  if (invoices.length === 0) return null
  const db = orgDb(admin, orgId)
  const jobIds = Array.from(new Set(invoices.map((i) => i.job_id).filter((x): x is string => !!x)))
  const [applied, jobsRes, first] = await Promise.all([
    loadAppliedCents(admin, invoices.map((i) => i.id)),
    db.from('production_jobs').select('id, job_number, address_text, property_id').in('id', jobIds),
    loadInvoiceDocument(admin, orgId, invoices[0]),
  ])
  const jobs = new Map(asRows<{ id: string; job_number: string; address_text: string | null; property_id: string | null }>(jobsRes.data).map((j) => [j.id, j]))
  const dev = await loadDevelopments(admin, orgId, Array.from(new Set(Array.from(jobs.values()).map((j) => j.property_id).filter((x): x is string => !!x))))
  const lines: BatchLine[] = invoices.map((i) => {
    const j = i.job_id ? jobs.get(i.job_id) : undefined
    const d = j?.property_id ? dev.byProperty.get(j.property_id) : undefined
    const roll = i.job_id ? opts.rollCounts?.get(i.job_id) : undefined
    return {
      invoiceId: i.id,
      invoiceNumber: i.invoice_number,
      jobId: i.job_id ?? '',
      jobNumber: j?.job_number ?? '',
      address: j?.address_text ?? '',
      lot: d?.lot ?? null,
      community: d?.community ?? null,
      customerPo: i.customer_po?.trim() || null,
      amountCents: i.total_cents,
      paidCents: invoicePaidCents(i, applied.get(i.id) ?? 0),
      ...(roll != null ? { rollCount: roll } : {}),
    }
  })
  const t = batchTotals(lines)
  const dues = invoices.map((i) => (i.due_at ? String(i.due_at).slice(0, 10) : '')).filter(Boolean).sort()
  return {
    batch: { id: batch.id, number: batch.batch_number, sentAt: batch.sent_at, sentToEmail: batch.sent_to_email, publicNote: batch.public_note, createdAt: batch.created_at },
    lines,
    ...t,
    development: batchDevelopment(lines),
    taxCents: invoices.reduce((s, i) => s + Math.max(0, Number(i.tax_cents ?? 0)), 0),
    dueAt: dues.length ? dues[dues.length - 1] : null,
    issued: invoices.every((i) => i.status !== 'draft'),
    billTo: { name: first.billTo.name, email: first.billTo.email },
    company: first.company,
  }
}

export type SendBatchResult = { ok: true; to: string; alreadySent?: boolean } | Err

/**
 * Send the master invoice. Order: check the address and sender, ISSUE every draft house (each queued for QuickBooks by
 * finalizeAndSendInvoice exactly as a single send would), THEN send the one email, then record `sent_at` on the batch.
 * A retry never re-sends an email that went (sent_at is set) unless `resend` is true (the office's "Email again"); a retry after
 * an email failure only sends the email, because the houses are already issued.
 */
export async function sendInvoiceBatch(admin: SupabaseClient, orgId: string, batch: BatchRow, opts: { to?: string | null; resend?: boolean } = {}): Promise<SendBatchResult> {
  const doc = await loadBatchDocument(admin, orgId, batch)
  if (!doc || doc.totalCents <= 0) return { ok: false, status: 400, error: 'This master invoice has nothing to bill.' }
  if (batch.sent_at && !opts.resend) return { ok: true, to: batch.sent_to_email ?? doc.billTo.email ?? '', alreadySent: true }
  const address = (opts.to ?? doc.billTo.email ?? '').trim()
  if (!isUsableCustomerEmail(address)) return { ok: false, status: 400, error: 'This customer has no email address' }
  const sender = await resolveInvoiceSender(admin, orgId, address)
  if (!sender.ok) return sender
  const members = await memberInvoices(admin, orgId, batch.id)
  const drafts = members.filter((i) => i.status === 'draft')
  const datesById = new Map<string, { issuedAt: string; dueAt: string }>()
  for (const d of drafts) datesById.set(d.id, await issueDatesFor(admin, d))
  for (const d of drafts) {
    try {
      await finalizeAndSendInvoice(admin, d.id, address, { dates: datesById.get(d.id) })
    } catch (e) {
      console.error('master invoice: could not issue a member', d.id, (e as Error).message)
      return { ok: false, status: 500, error: `Invoice ${d.invoice_number} could not be issued, so nothing was emailed. Press send again.` }
    }
  }
  const dueAfter = Array.from(datesById.values()).map((d) => d.dueAt).sort().pop() ?? doc.dueAt
  const portalBase = await tryOrgAppUrl(orgId, 'master invoice portal link')
  const mail = renderBatchEmail({ ...doc, dueAt: dueAfter }, { portalUrl: portalBase ? `${portalBase}/portal/batches/${batch.id}` : null })
  try {
    await getMailTransport(orgId).sendMail({ from: sender.from, to: address, replyTo: sender.replyTo, subject: mail.subject, html: mail.html, text: mail.text })
  } catch (e) {
    console.error('master invoice: email failed', batch.id, (e as Error).message)
    return { ok: false, status: 503, error: 'The invoices are issued but the email did not go. Press send again.' }
  }
  await orgDb(admin, orgId).from('invoice_batches').update({ sent_at: new Date().toISOString(), sent_to_email: address }).eq('id', batch.id)
  return { ok: true, to: address }
}

export type BatchPaymentInput = { amountCents: number; paidAt: string; method: CustomerPaymentMethod; note?: string | null; clientKey: string }
export type BatchPaymentResult = { ok: true; parts: number; alreadyRecorded: boolean } | Err
type Allocation = { invoice_id: string; job_id: string | null; cents: number; payment_id: string | null }
type PaymentRow = { id: string; amount_cents: number; method: string; paid_on: string; note: string | null; allocations: unknown; receipt_claimed_at: string | null }

/**
 * ONE payment against the master invoice. The split over the houses (oldest first) is decided ONCE and saved on a
 * `batch_payments` row before any money is written; every house is then paid through the existing per-invoice writer
 * (`payPart`, idempotent by `batch-pay:<batch>:<key>:<invoice>`) and its payment id saved back. A retry (same `clientKey`) applies
 * each saved allocation exactly — it never re-splits live balances — so a failure half-way is finished, never doubled. The
 * receipt is claimed on the row (compare-and-set), so exactly one goes out however many times it is tapped.
 */
export async function recordBatchPayment(admin: SupabaseClient, orgId: string, userId: string, batch: BatchRow, p: BatchPaymentInput): Promise<BatchPaymentResult> {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return { ok: false, status: 400, error: 'Enter an amount above zero' }
  if (!(CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(p.method)) return { ok: false, status: 400, error: 'Pick how it was paid' }
  if (!/^[0-9A-Za-z_-]{8,64}$/.test(p.clientKey)) return { ok: false, status: 400, error: 'Missing payment key' }
  const db = orgDb(admin, orgId)
  const readRow = async () => (await db.from('batch_payments').select('id, amount_cents, method, paid_on, note, allocations, receipt_claimed_at').eq('batch_id', batch.id).eq('client_key', p.clientKey).maybeSingle()).data as PaymentRow | null
  const probe = await db.from('batch_payments').select('id', { head: true, count: 'exact' }).limit(1)
  if (probe.error) return isMissingTable(probe.error) ? NOT_SET_UP : { ok: false, status: 500, error: 'Could not record the payment.' }

  let row = await readRow()
  if (row && row.amount_cents !== p.amountCents) return { ok: false, status: 409, error: 'That payment key was already used for a different amount. Reopen the payment and try again.' }
  if (!row) {
    const members = await memberInvoices(admin, orgId, batch.id)
    if (members.length === 0) return { ok: false, status: 409, error: 'This master invoice has no invoices.' }
    if (members.some((i) => i.status === 'draft')) return { ok: false, status: 409, error: 'Send the master invoice before recording a payment.' }
    const open: Array<{ id: string; balanceCents: number }> = []
    for (const i of members) {
      const b = await computeInvoiceBalance(admin, i.id)
      if (b.balance_cents > 0) open.push({ id: i.id, balanceCents: b.balance_cents })
    }
    const split = splitBatchPayment(p.amountCents, open)
    if (split.leftoverCents > 0 || split.parts.length === 0) return { ok: false, status: 400, error: 'That is more than the master invoice balance.' }
    const jobOf = new Map(members.map((i) => [i.id, i.job_id]))
    const allocations: Allocation[] = split.parts.map((s) => ({ invoice_id: s.invoiceId, job_id: jobOf.get(s.invoiceId) ?? null, cents: s.cents, payment_id: null }))
    const day = /^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) ? p.paidAt : ymdInZone(new Date(), await loadOrgTimeZone(admin, orgId))
    const ins = await db.from('batch_payments').insert({ batch_id: batch.id, client_key: p.clientKey, amount_cents: p.amountCents, method: p.method, paid_on: day, note: p.note?.trim().slice(0, 400) || null, allocations, created_by: userId }).select('id, amount_cents, method, paid_on, note, allocations, receipt_claimed_at').single()
    if (ins.error) {
      if (ins.error.code !== '23505') throw new Error(`master invoice: save payment: ${ins.error.message}`)
      row = await readRow() // a double tap saved the same payment first: finish THAT one
    } else row = ins.data as PaymentRow
  }
  if (!row) return { ok: false, status: 500, error: 'Could not record the payment.' }

  const allocations = (Array.isArray(row.allocations) ? (row.allocations as Allocation[]) : []).filter((a) => a && typeof a.invoice_id === 'string' && Number.isInteger(a.cents))
  const pending = allocations.filter((a) => !a.payment_id)
  const note = `${row.note || 'Payment'} · master invoice ${batch.batch_number}`
  for (const a of pending) {
    const r = await payPart(admin, orgId, { invoice_id: a.invoice_id, cents: a.cents, payment_id: null, job_id: a.job_id }, { day: row.paid_on, method: row.method as CustomerPaymentMethod, note, userId, key: `batch-pay:${batch.id}:${p.clientKey}:${a.invoice_id}` })
    if (!r.ok) return { ok: false, status: r.status === 500 ? 500 : 409, error: `${r.error} Houses already paid stay paid — press save again to finish the rest.` }
    a.payment_id = r.paymentId
    await db.from('batch_payments').update({ allocations }).eq('id', row.id)
  }
  // One receipt: whoever flips the claim from empty sends it; a second tap finds it taken.
  const { data: claimed } = await db.from('batch_payments').update({ receipt_claimed_at: new Date().toISOString() }).eq('id', row.id).is('receipt_claimed_at', null).select('id')
  if (asRows<{ id: string }>(claimed).length > 0) {
    await sendPaymentReceipt(admin, orgId, { paymentId: allocations[0]?.payment_id ?? row.id, payer: 'homeowner', amountCents: row.amount_cents, paidAt: row.paid_on, method: row.method, ...(allocations.length === 1 ? { invoiceId: allocations[0].invoice_id } : { customerId: batch.customer_id }) })
  }
  return { ok: true, parts: pending.length, alreadyRecorded: pending.length === 0 }
}

export type BatchSummary = { id: string; number: string; customerId: string; createdAt: string; sentAt: string | null; jobCount: number; totalCents: number; paidCents: number; balanceCents: number }

/** The company's master invoices (newest first, ≤ 200), optionally one customer's. Empty before the migration. */
export async function loadBatchSummaries(admin: SupabaseClient, orgId: string, opts: { customerId?: string | null } = {}): Promise<BatchSummary[]> {
  const db = orgDb(admin, orgId)
  let q = db.from('invoice_batches').select('*').order('created_at', { ascending: false }).limit(200)
  if (opts.customerId) q = q.eq('customer_id', opts.customerId)
  const { data, error } = await q
  if (error) return []
  const batches = asRows<BatchRow>(data)
  if (batches.length === 0) return []
  const { data: inv } = await db.from('job_invoices').select('id, batch_id, total_cents, paid_outside_cents').in('batch_id', batches.map((b) => b.id)).neq('status', 'void')
  const members = asRows<{ id: string; batch_id: string; total_cents: number; paid_outside_cents?: number | null }>(inv)
  const applied = await loadAppliedCents(admin, members.map((m) => m.id))
  return batches.map((b) => {
    const mine = members.filter((m) => m.batch_id === b.id)
    const t = batchTotals(mine.map((m) => ({ amountCents: m.total_cents, paidCents: invoicePaidCents(m as never, applied.get(m.id) ?? 0) })))
    return { id: b.id, number: b.batch_number, customerId: b.customer_id, createdAt: b.created_at, sentAt: b.sent_at, jobCount: mine.length, ...t }
  })
}
