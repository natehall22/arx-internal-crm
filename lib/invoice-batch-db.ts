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
import { createFinalInvoice, computeInvoiceBalance, finalizeAndSendInvoice, issueDatesFor, type CustomerPaymentMethod, CUSTOMER_PAYMENT_METHODS } from '@/lib/invoices'
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

/** What a job still lets a master invoice bill: the contract left after the deposit already collected on it. */
export type BillableJob = {
  jobId: string
  jobNumber: string
  address: string
  lot: string | null
  community: string | null
  customerPo: string | null
  amountCents: number
  completedAt: string | null
  /** A draft job invoice already exists (the batch reuses it instead of making a second). */
  draftInvoiceId: string | null
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
 * The customer's finished (status 'complete'), not-yet-billed fixed-price jobs. Billed = a live job invoice other than a deposit
 * (a draft not yet in a master invoice does not count: it is reused). Time & materials jobs are billed from Hours to bill.
 * `developmentsAvailable` = the properties columns exist (the screen offers the development filter only then).
 */
export async function loadBillableJobs(admin: SupabaseClient, orgId: string, customerId: string): Promise<{ jobs: BillableJob[]; developmentsAvailable: boolean }> {
  const db = orgDb(admin, orgId)
  let jobsRes = await db.from('production_jobs').select('id, job_number, address_text, sale_amount, customer_po, completed_at, property_id, billing_mode').eq('customer_id', customerId).eq('status', 'complete').limit(500)
  if (isMissingColumn(jobsRes.error, 'customer_po')) jobsRes = await db.from('production_jobs').select('id, job_number, address_text, sale_amount, completed_at, property_id, billing_mode').eq('customer_id', customerId).eq('status', 'complete').limit(500)
  if (jobsRes.error) throw new Error(`master invoice: read jobs: ${jobsRes.error.message}`)
  const jobs = asRows<{ id: string; job_number: string; address_text: string | null; sale_amount: number | null; customer_po?: string | null; completed_at: string | null; property_id: string | null; billing_mode?: string | null }>(jobsRes.data).filter((j) => j.billing_mode !== 'time_materials')
  if (jobs.length === 0) return { jobs: [], developmentsAvailable: false }
  const ids = jobs.map((j) => j.id)
  const { data: invs, error: invErr } = await db.from('job_invoices').select('id, job_id, status, invoice_kind, batch_id').in('job_id', ids).neq('status', 'void')
  if (invErr) throw new Error(`master invoice: read invoices: ${invErr.message}`)
  const live = asRows<{ id: string; job_id: string; status: string; invoice_kind: string; batch_id?: string | null }>(invs).filter((i) => i.invoice_kind !== 'deposit')
  const blocked = new Set<string>()
  const draftOf = new Map<string, string>()
  for (const i of live) {
    if (i.status === 'draft' && !i.batch_id && !draftOf.has(i.job_id)) draftOf.set(i.job_id, i.id)
    else blocked.add(i.job_id)
  }
  const open = jobs.filter((j) => !blocked.has(j.id))
  const dev = await loadDevelopments(admin, orgId, Array.from(new Set(open.map((j) => j.property_id).filter((x): x is string => !!x))))
  const out: BillableJob[] = []
  for (const j of open) {
    const saleCents = Math.round(Number(j.sale_amount ?? 0) * 100)
    if (saleCents <= 0) continue
    // org-scope-ok: job_payments has no org_id for job payments; j.id is a job of this company (loaded with orgDb above)
    const { data: dep } = await admin.from('job_payments').select('amount_cents').eq('job_id', j.id).eq('payment_type', 'deposit').gt('amount_cents', 0)
    const depositCents = asRows<{ amount_cents: number }>(dep).reduce((s, p) => s + p.amount_cents, 0)
    const remaining = saleCents - depositCents
    if (remaining <= 0) continue
    const d = j.property_id ? dev.byProperty.get(j.property_id) : undefined
    out.push({ jobId: j.id, jobNumber: j.job_number, address: j.address_text ?? '', lot: d?.lot ?? null, community: d?.community ?? null, customerPo: j.customer_po?.trim() || null, amountCents: remaining, completedAt: j.completed_at, draftInvoiceId: draftOf.get(j.id) ?? null })
  }
  out.sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.jobNumber.localeCompare(b.jobNumber))
  return { jobs: out, developmentsAvailable: dev.available }
}

export type CreateBatchResult = { ok: true; batchId: string; number: string } | Err

/** "Bill finished jobs": one master invoice over the chosen jobs (each must still be billable). Drafts only; nothing is sent. */
export async function createInvoiceBatch(admin: SupabaseClient, orgId: string, userId: string, input: { customerId: string; jobIds: string[]; publicNote?: string | null }): Promise<CreateBatchResult> {
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
  if (picked.some((j) => !j)) return { ok: false, status: 409, error: 'One of those jobs is already billed or is not finished. Refresh the list.' }

  const invoiceIds: string[] = []
  for (const j of picked as BillableJob[]) {
    if (j.draftInvoiceId) {
      invoiceIds.push(j.draftInvoiceId)
      continue
    }
    try {
      invoiceIds.push((await createFinalInvoice(admin, j.jobId, userId)).id)
    } catch (e) {
      // Invoices already made stay as drafts: a retry reuses them (loadBillableJobs lists them with draftInvoiceId).
      return { ok: false, status: 409, error: `Could not bill job ${j.jobNumber}: ${(e as Error).message}` }
    }
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
    const { error: linkErr } = await db.from('job_invoices').update({ batch_id: batchId }).in('id', invoiceIds)
    if (linkErr) {
      // A batch holds no money, so an empty one is safe to remove; the drafts stay and are reused by the retry.
      await db.from('invoice_batches').delete().eq('id', batchId)
      return { ok: false, status: 500, error: 'Could not group the invoices. Try again.' }
    }
    return { ok: true, batchId, number }
  }
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

export type SendBatchResult = { ok: true; to: string } | Err

/**
 * Email the master invoice once, then issue every draft member (each is queued for QuickBooks by finalizeAndSendInvoice exactly
 * as a single send would). Email first, status second. Sending again just re-emails it.
 */
export async function sendInvoiceBatch(admin: SupabaseClient, orgId: string, batch: BatchRow, toOverride?: string | null): Promise<SendBatchResult> {
  const doc = await loadBatchDocument(admin, orgId, batch)
  if (!doc || doc.totalCents <= 0) return { ok: false, status: 400, error: 'This master invoice has nothing to bill.' }
  const address = (toOverride ?? doc.billTo.email ?? '').trim()
  if (!isUsableCustomerEmail(address)) return { ok: false, status: 400, error: 'This customer has no email address' }
  const sender = await resolveInvoiceSender(admin, orgId, address)
  if (!sender.ok) return sender
  const members = await memberInvoices(admin, orgId, batch.id)
  const drafts = members.filter((i) => i.status === 'draft')
  const datesById = new Map<string, { issuedAt: string; dueAt: string }>()
  for (const d of drafts) datesById.set(d.id, await issueDatesFor(admin, d))
  const dueAfter = Array.from(datesById.values()).map((d) => d.dueAt).sort().pop() ?? doc.dueAt
  const portalBase = await tryOrgAppUrl(orgId, 'master invoice portal link')
  const mail = renderBatchEmail({ ...doc, dueAt: dueAfter }, { portalUrl: portalBase ? `${portalBase}/portal/batches/${batch.id}` : null })
  await getMailTransport(orgId).sendMail({ from: sender.from, to: address, replyTo: sender.replyTo, subject: mail.subject, html: mail.html, text: mail.text })
  for (const d of drafts) {
    try {
      await finalizeAndSendInvoice(admin, d.id, address, { dates: datesById.get(d.id) })
    } catch (e) {
      console.error('master invoice: could not issue a member', d.id, (e as Error).message)
      return { ok: false, status: 500, error: `The email went out, but invoice ${d.invoice_number} could not be marked sent. Send the master invoice again.` }
    }
  }
  await orgDb(admin, orgId).from('invoice_batches').update({ sent_at: new Date().toISOString(), sent_to_email: address }).eq('id', batch.id)
  return { ok: true, to: address }
}

export type BatchPaymentInput = { amountCents: number; paidAt: string; method: CustomerPaymentMethod; note?: string | null; clientKey: string }
export type BatchPaymentResult = { ok: true; parts: number; alreadyRecorded: boolean } | Err

/**
 * ONE payment against the master invoice, split over its job invoices oldest first by the existing per-invoice writer. The
 * split is safe to retry: each member invoice has its own key (`batch-pay:<batch>:<clientKey>:<invoice>`), and what a key
 * already wrote counts toward the amount, so a retry after a failure finishes the same payment and never pays twice.
 */
export async function recordBatchPayment(admin: SupabaseClient, orgId: string, userId: string, batch: BatchRow, p: BatchPaymentInput): Promise<BatchPaymentResult> {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return { ok: false, status: 400, error: 'Enter an amount above zero' }
  if (!(CUSTOMER_PAYMENT_METHODS as readonly string[]).includes(p.method)) return { ok: false, status: 400, error: 'Pick how it was paid' }
  if (!/^[0-9A-Za-z_-]{8,64}$/.test(p.clientKey)) return { ok: false, status: 400, error: 'Missing payment key' }
  const members = await memberInvoices(admin, orgId, batch.id)
  if (members.length === 0) return { ok: false, status: 409, error: 'This master invoice has no invoices.' }
  if (members.some((i) => i.status === 'draft')) return { ok: false, status: 409, error: 'Send the master invoice before recording a payment.' }

  const prefix = `batch-pay:${batch.id}:${p.clientKey}:`
  const jobIds = members.map((i) => i.job_id).filter((x): x is string => !!x)
  // org-scope-ok: job_payments has no org_id for job payments; the job ids are this company's (member invoices loaded with orgDb)
  const { data: written } = await admin.from('job_payments').select('amount_cents').in('job_id', jobIds).like('idempotency_key', `${prefix}%`)
  const writtenCents = asRows<{ amount_cents: number }>(written).reduce((s, r) => s + r.amount_cents, 0)
  const remaining = p.amountCents - writtenCents
  if (remaining <= 0) return { ok: true, parts: 0, alreadyRecorded: true }

  const open: Array<{ id: string; balanceCents: number; jobId: string | null }> = []
  for (const i of members) {
    const b = await computeInvoiceBalance(admin, i.id)
    if (b.balance_cents > 0) open.push({ id: i.id, balanceCents: b.balance_cents, jobId: i.job_id })
  }
  const split = splitBatchPayment(remaining, open)
  if (split.leftoverCents > 0) return { ok: false, status: 400, error: 'That is more than the master invoice balance.' }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) ? p.paidAt : ymdInZone(new Date(), await loadOrgTimeZone(admin, orgId))
  const jobOf = new Map(open.map((o) => [o.id, o.jobId]))
  const note = `${p.note?.trim().slice(0, 400) || 'Payment'} · master invoice ${batch.batch_number}`
  let firstPaymentId = ''
  for (const part of split.parts) {
    const r = await payPart(admin, orgId, { invoice_id: part.invoiceId, cents: part.cents, payment_id: null, job_id: jobOf.get(part.invoiceId) ?? null }, { day, method: p.method, note, userId, key: `${prefix}${part.invoiceId}` })
    if (!r.ok) return { ok: false, status: r.status === 500 ? 500 : 409, error: `${r.error} Parts already recorded stay recorded — try again to finish the rest.` }
    firstPaymentId ||= r.paymentId
  }
  // ONE receipt for the whole payment (the parts sent none).
  await sendPaymentReceipt(admin, orgId, { paymentId: firstPaymentId, payer: 'homeowner', amountCents: p.amountCents, paidAt: day, method: p.method, ...(split.parts.length === 1 ? { invoiceId: split.parts[0].invoiceId } : { customerId: batch.customer_id }) })
  return { ok: true, parts: split.parts.length, alreadyRecorded: false }
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
