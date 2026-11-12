/**
 * What each outbox event DOES in QuickBooks. One function per event type, all built from the same few moves:
 *
 *   1. read the CRM record NOW (crm.ts) and decide whether it may be sent at all (start date, mode, draft, switches);
 *   2. make sure what it points at exists in QuickBooks (customer, job sub-customer, vendor, invoice);
 *   3. FIND-BEFORE-SEND: ask QuickBooks for the record by our link, then by our reference in PrivateNote / DocNumber / name. Found = adopt
 *      it (write the link), never create a second one. This runs on EVERY create, not only on a retry: a worker that died after QuickBooks
 *      said yes but before we saved the link finds its own record here;
 *   4. send with a `requestid` (so even a lost answer replays instead of duplicating), then write `qb_links`;
 *   5. never overwrite a QuickBooks record a person changed (its total no longer matches what we last sent) and never delete anything:
 *      a CRM void becomes a QuickBooks void, a CRM bill void becomes a line for a human.
 *
 * Anything that cannot go on throws `Halt(outcome)`; the worker turns the outcome into back-off / Needs you / stop.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  BuildError,
  buildBillBody,
  buildCustomerBody,
  buildInvoiceBody,
  buildPaymentBody,
  buildRefundReceiptBody,
  buildSubCustomerBody,
  buildVendorBody,
  crmMarker,
  customerNameCandidates,
  dollars,
  fingerprintOf,
  invoiceFacts,
  qbCents,
  requestIdFor,
  samePerson,
  subCustomerName,
  vendorNameCandidates,
  customerNoteMarker,
  type PaymentApplication,
  type QbRefKind,
} from './builders'
import type { QbClient, QbEntity, QbObject } from './client'
import { loadBill, loadCrmInvoice, loadCustomer, loadJob, loadJobSaleInvoice, loadPayment, loadVendor, type CrmInvoice, type CrmJob } from './crm'
import { isRetryable, plainReason, type QbCallError, type QbResult } from './faults'
import type { QbLinks } from './links'
import type { QbSettings } from './mapping'
import type { OutboxRow } from './outbox'

export type Outcome =
  | { kind: 'done'; qbType: string | null; qbId: string | null; warning?: { code: string; message: string } | null }
  | { kind: 'skipped'; code: string; message: string }
  | { kind: 'retry'; code: string | null; message: string; delayMs?: number; stop?: 'throttled' }
  | { kind: 'needs_you'; code: string | null; message: string }
  | { kind: 'stop'; reason: 'auth' | 'company_stopped'; message: string }

export class Halt extends Error {
  constructor(readonly outcome: Outcome) {
    super(outcome.kind)
  }
}

export type HandlerCtx = {
  admin: SupabaseClient
  orgId: string
  client: QbClient
  settings: QbSettings
  links: QbLinks
  /** The event's own day in the company's time zone (customers have no business date of their own). */
  eventDay: string
}

const needsYou = (code: string | null, message: string): never => {
  throw new Halt({ kind: 'needs_you', code, message })
}
const skip = (code: string, message: string): never => {
  throw new Halt({ kind: 'skipped', code, message })
}

export function outcomeForError(e: QbCallError): Outcome {
  if (e.kind === 'throttled') return { kind: 'retry', code: 'throttled', message: plainReason(e), delayMs: (e.retryAfterSec ?? 60) * 1000, stop: 'throttled' }
  if (e.kind === 'auth' || e.kind === 'company_stopped') return { kind: 'stop', reason: e.kind, message: plainReason(e) }
  if (isRetryable(e.kind)) return { kind: 'retry', code: e.code ?? e.kind, message: plainReason(e) }
  return { kind: 'needs_you', code: e.code ?? e.kind, message: plainReason(e) }
}

/** Unwrap a QuickBooks answer or stop the handler with the right outcome. */
function must<T>(r: QbResult<T>): T {
  if (r.ok) return r.value
  throw new Halt(outcomeForError(r))
}

const before = (day: string, start: string | null) => !start || !day || day < start

// ---------------------------------------------------------------- find helpers
async function findByName(ctx: HandlerCtx, entity: 'Customer' | 'Vendor', name: string): Promise<QbObject[]> {
  // Active names only here; an inactive twin makes the later create fail with "duplicate name", which becomes a plain Needs-you line.
  return must(await ctx.client.query<QbObject>(entity, `DisplayName = ${qbQuoteLocal(name)}`, { max: 10 }))
}
const qbQuoteLocal = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** An object whose PrivateNote carries OUR reference (it can only be the record an earlier attempt created). */
async function findOurs(ctx: HandlerCtx, entity: QbEntity, marker: string, wheres: string[]): Promise<QbObject | null> {
  for (const where of wheres) {
    const rows = must(await ctx.client.query<QbObject>(entity, where, { max: 200, orderBy: entity === 'Customer' ? undefined : 'TxnDate desc' }))
    const hit = rows.find((r) => typeof r.PrivateNote === 'string' && r.PrivateNote.includes(marker))
    if (hit) return hit
  }
  return null
}

async function adopt(ctx: HandlerCtx, crmTable: string, crmId: string, qbType: string, obj: QbObject, extra: { fingerprint?: string | null; sentTotalCents?: number | null } = {}): Promise<void> {
  if (!obj.Id) throw new Halt({ kind: 'needs_you', code: 'bad_answer', message: 'QuickBooks answered without a record number.' })
  const put = await ctx.links.put({ crmTable, crmId, qbType, qbId: String(obj.Id), syncToken: obj.SyncToken ?? null, ...extra })
  if (!put.ok) needsYou(put.reason === 'qb_record_taken' ? 'link_taken' : 'link_error', put.reason === 'qb_record_taken' ? `QuickBooks record ${obj.Id} is already matched to a different record in the CRM.` : 'Could not save the QuickBooks link. This will be tried again.')
}

// ---------------------------------------------------------------- customers + jobs
/** The QuickBooks customer for a CRM customer. Created on first need, matched (never duplicated) when it already exists. */
export async function ensureCustomer(ctx: HandlerCtx, customerId: string): Promise<string> {
  const link = await ctx.links.get('customers', customerId, 'Customer')
  if (link) return link.qb_id
  const c = await loadCustomer(ctx.admin, ctx.orgId, customerId)
  if (!c) return needsYou('not_found', 'This customer is no longer in the CRM.')
  for (const name of customerNameCandidates(c)) {
    const found = (await findByName(ctx, 'Customer', name)).find((r) => !r.Job)
    if (found) {
      // Our own reference in Notes = the customer an earlier, unanswered attempt created: adopt it first. Otherwise the same name is only
      // "the same person" when the CRM's identity rule (email / phone / name + address) agrees; else this name belongs to someone else.
      const holder = found.Id ? await ctx.links.holder('Customer', String(found.Id)) : null
      const ours = typeof found.Notes === 'string' && found.Notes.includes(customerNoteMarker(ctx.orgId, customerId))
      if ((ours || samePerson(c, found)) && !holder) {
        await adopt(ctx, 'customers', customerId, 'Customer', found)
        return String(found.Id)
      }
      continue
    }
    const made = await ctx.client.create<QbObject>('Customer', buildCustomerBody(c, name, customerNoteMarker(ctx.orgId, customerId)), requestIdFor(ctx.orgId, `cust:${customerId}`, { name, e: c.email, p: c.phone, a: c.addressText }))
    if (!made.ok && made.kind === 'duplicate_name') continue
    const obj = must(made)
    await adopt(ctx, 'customers', customerId, 'Customer', obj)
    return String(obj.Id)
  }
  return needsYou('6240', `QuickBooks already has someone named “${c.name}” who does not match this customer’s email, phone or address. Rename one of them in QuickBooks, then press Retry.`)
}

/** The job's sub-customer ("Job" under the customer). All of a job's money posts to it. */
export async function ensureJobCustomer(ctx: HandlerCtx, job: CrmJob): Promise<string> {
  const link = await ctx.links.get('production_jobs', job.id, 'Customer')
  if (link) return link.qb_id
  if (!job.customerId) return needsYou('no_customer', `Job ${job.jobNumber} has no customer in the CRM, so it cannot be sent to QuickBooks.`)
  const parent = await ensureCustomer(ctx, job.customerId)
  const base = subCustomerName(job)
  for (const name of [base, `${base} (${job.id.slice(0, 4)})`]) {
    const found = (await findByName(ctx, 'Customer', name)).find((r) => r.Job && String(r.ParentRef?.value) === parent)
    if (found) {
      const holder = found.Id ? await ctx.links.holder('Customer', String(found.Id)) : null
      if (holder) continue
      await adopt(ctx, 'production_jobs', job.id, 'Customer', found)
      return String(found.Id)
    }
    const made = await ctx.client.create<QbObject>('Customer', { ...buildSubCustomerBody(job, parent), DisplayName: name }, requestIdFor(ctx.orgId, `job:${job.id}`, { name, parent }))
    if (!made.ok && made.kind === 'duplicate_name') continue
    const obj = must(made)
    await adopt(ctx, 'production_jobs', job.id, 'Customer', obj)
    return String(obj.Id)
  }
  return needsYou('6240', `QuickBooks already has a job named “${base}” under a different customer. Rename it in QuickBooks, then press Retry.`)
}

/** Where a document's money posts: the job's sub-customer when it has a job, else the customer. */
async function customerRefFor(ctx: HandlerCtx, t: { jobId: string | null; customerId: string | null }): Promise<string> {
  if (t.jobId) {
    const job = await loadJob(ctx.admin, ctx.orgId, t.jobId)
    if (!job) return needsYou('not_found', 'The job is no longer in the CRM.')
    return ensureJobCustomer(ctx, job)
  }
  if (!t.customerId) return needsYou('no_customer', 'There is no customer on this record, so it cannot be sent to QuickBooks.')
  return ensureCustomer(ctx, t.customerId)
}

async function ensureVendor(ctx: HandlerCtx, vendorId: string): Promise<string> {
  const link = await ctx.links.get('vendors', vendorId, 'Vendor')
  const is1099 = ctx.settings.vendors1099.includes(vendorId)
  if (link) {
    // The 1099 flag is the one vendor fact that can change after the first send (the owner ticks it later): keep QuickBooks in step.
    if ((link.fingerprint === '1099:true') !== is1099) {
      const cur = must(await ctx.client.read<QbObject>('Vendor', link.qb_id))
      const r = await ctx.client.update<QbObject>('Vendor', { Id: String(cur.Id), SyncToken: String(cur.SyncToken ?? '0'), sparse: true, Vendor1099: is1099 }, requestIdFor(ctx.orgId, `vendor-upd:${vendorId}:${cur.SyncToken}`, { is1099 }))
      if (!r.ok && r.kind === 'stale') return link.qb_id // re-read next time; the vendor itself is fine
      const obj = must(r)
      await ctx.links.put({ crmTable: 'vendors', crmId: vendorId, qbType: 'Vendor', qbId: link.qb_id, syncToken: obj.SyncToken ?? null, fingerprint: `1099:${is1099}` })
    }
    return link.qb_id
  }
  const v = await loadVendor(ctx.admin, ctx.orgId, vendorId)
  if (!v) return needsYou('not_found', 'This vendor is no longer in the CRM.')
  for (const name of vendorNameCandidates(v)) {
    const found = (await findByName(ctx, 'Vendor', name))[0]
    if (found) {
      // A vendor with the very same name is the same business far more often than not; a person can still fix a wrong match in QuickBooks.
      const holder = found.Id ? await ctx.links.holder('Vendor', String(found.Id)) : null
      if (holder) continue
      await adopt(ctx, 'vendors', vendorId, 'Vendor', found, { fingerprint: `1099:${is1099 && found.Vendor1099 === true}` })
      if (is1099 && found.Vendor1099 !== true) return ensureVendor(ctx, vendorId) // flag the adopted vendor too
      return String(found.Id)
    }
    const made = await ctx.client.create<QbObject>('Vendor', buildVendorBody(v, name, is1099), requestIdFor(ctx.orgId, `vendor:${vendorId}`, { name, is1099 }))
    if (!made.ok && made.kind === 'duplicate_name') continue
    const obj = must(made)
    await adopt(ctx, 'vendors', vendorId, 'Vendor', obj, { fingerprint: `1099:${is1099}` })
    return String(obj.Id)
  }
  return needsYou('6240', `QuickBooks already has a customer or employee named “${v.name}”. Rename one of them in QuickBooks, then press Retry.`)
}

// ---------------------------------------------------------------- invoices
const sourceCrmTable = (i: Pick<CrmInvoice, 'source'>) => i.source.table

function totalWarning(inv: CrmInvoice, qbTotalCents: number): { code: string; message: string } | null {
  if (qbTotalCents === inv.totalCents) return null
  return {
    code: 'total_differs',
    message: `QuickBooks totals invoice ${inv.docNumber} at $${dollars(qbTotalCents).toFixed(2)} but the CRM says $${dollars(inv.totalCents).toFixed(2)} (QuickBooks works out sales tax its own way). The CRM did not change it in QuickBooks. Ask your bookkeeper which amount is right, then press Skip.`,
  }
}

/** Create or update the ONE QuickBooks invoice for a CRM invoice (job sale or CRM invoice row). Returns the QuickBooks invoice. */
export async function syncInvoice(ctx: HandlerCtx, inv: CrmInvoice): Promise<{ qb: QbObject; warning: { code: string; message: string } | null; unchanged: boolean }> {
  const s = ctx.settings
  if (!inv.customerId) return needsYou('no_customer', `Invoice ${inv.docNumber} has no customer, so it cannot be sent to QuickBooks.`)
  if (inv.totalCents <= 0) return skip('zero_total', `Invoice ${inv.docNumber} is $0.`)
  if (inv.extraTaxCents > 0 && s.invoiceMode === 'per_job') {
    // Not an error: the sale amount posts; the extra tax is surfaced so the bookkeeper adds it.
  }
  const customerRef = await customerRefFor(ctx, { jobId: inv.jobId, customerId: inv.customerId })
  const prior = await ctx.links.get(sourceCrmTable(inv), inv.source.id, 'Invoice')
  // The CRM voided this invoice earlier (job cancelled, then restored). QuickBooks cannot un-void: send the sale again as a NEW invoice.
  if (prior && prior.sent_total_cents === 0) return reissueAfterVoid(ctx, inv, customerRef, prior.qb_id)
  let body: Record<string, unknown>
  try {
    body = buildInvoiceBody(inv, { settings: s, customerRef })
  } catch (e) {
    if (e instanceof BuildError) return needsYou(e.code, e.message)
    throw e
  }
  const facts = invoiceFacts(inv, customerRef, s)
  const fp = fingerprintOf(facts)
  const table = sourceCrmTable(inv)
  const id = inv.source.id
  const marker = crmMarker('inv', id)

  let link = await ctx.links.get(table, id, 'Invoice')
  let known: QbObject | null = null
  let adopted = false

  // Nothing we stand behind has changed since the last send: do not touch QuickBooks again (the warning, if any, is still shown).
  if (link && link.fingerprint === fp) {
    return { qb: { Id: link.qb_id, SyncToken: link.sync_token ?? undefined }, warning: totalWarning(inv, link.sent_total_cents ?? inv.totalCents) ?? extraTaxWarning(inv), unchanged: true }
  }

  if (!link) {
    // FIND BEFORE SEND — by our document number first, then by our reference on this customer's invoices.
    const byNumber = must(await ctx.client.query<QbObject>('Invoice', `DocNumber = ${qbQuoteLocal(String(body.DocNumber))}`, { max: 10 }))
    const ours = byNumber.find((r) => String(r.PrivateNote ?? '').includes(marker)) ?? (await findOurs(ctx, 'Invoice', marker, [`CustomerRef = ${qbQuoteLocal(customerRef)}`]))
    if (ours) {
      known = ours
      adopted = true
      await adopt(ctx, table, id, 'Invoice', ours)
      link = await ctx.links.get(table, id, 'Invoice')
    } else {
      const made = await ctx.client.create<QbObject>('Invoice', body, requestIdFor(ctx.orgId, `inv:${id}`, facts))
      if (!made.ok && made.kind === 'duplicate_number') {
        const again = (await ctx.client.query<QbObject>('Invoice', `DocNumber = ${qbQuoteLocal(String(body.DocNumber))}`, { max: 10 }))
        const mine = again.ok ? again.value.find((r) => String(r.PrivateNote ?? '').includes(marker)) : null
        if (!mine) return needsYou('6210', `QuickBooks already has a different document numbered ${inv.docNumber}. Change or remove that one in QuickBooks, then press Retry.`)
        known = mine
        adopted = true
        await adopt(ctx, table, id, 'Invoice', mine)
        link = await ctx.links.get(table, id, 'Invoice')
      } else {
        const obj = must(made)
        const total = qbCents(obj.TotalAmt)
        await adopt(ctx, table, id, 'Invoice', obj, { fingerprint: fp, sentTotalCents: total })
        return { qb: obj, warning: totalWarning(inv, total) ?? extraTaxWarning(inv), unchanged: false }
      }
    }
  }

  // UPDATE path (an existing link, or a record we just found that an earlier attempt created).
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = known && attempt === 0 ? known : must(await ctx.client.read<QbObject>('Invoice', link!.qb_id))
    const curTotal = qbCents(cur.TotalAmt)
    if (/^Voided/i.test(String(cur.PrivateNote ?? '')) && curTotal === 0 && inv.totalCents > 0) {
      return needsYou('voided_in_qb', `Invoice ${inv.docNumber} was voided in QuickBooks. The CRM does not bring it back; ask your bookkeeper, then press Skip.`)
    }
    // A person changed the total in QuickBooks since we last sent it: never overwrite.
    if (!adopted && link!.sent_total_cents != null && curTotal !== link!.sent_total_cents) {
      return needsYou('changed_in_qb', `Invoice ${inv.docNumber} was changed in QuickBooks (now $${dollars(curTotal).toFixed(2)}; the CRM last sent $${dollars(link!.sent_total_cents).toFixed(2)} and now says $${dollars(inv.totalCents).toFixed(2)}). The CRM will not overwrite QuickBooks. Fix one side, then press Retry.`)
    }
    if (adopted && curTotal === inv.totalCents) {
      await adopt(ctx, table, id, 'Invoice', cur, { fingerprint: fp, sentTotalCents: curTotal })
      return { qb: cur, warning: extraTaxWarning(inv), unchanged: false }
    }
    // The document number never changes after the first send (a reissued invoice carries a -R number).
    const { DocNumber: _keep, ...updateBody } = body
    const r = await ctx.client.update<QbObject>('Invoice', { ...updateBody, Id: String(cur.Id), SyncToken: String(cur.SyncToken ?? '0'), sparse: true }, requestIdFor(ctx.orgId, `inv-upd:${id}:${cur.SyncToken}`, facts))
    if (!r.ok && r.kind === 'stale' && attempt === 0) {
      known = null
      adopted = false
      continue // re-read the fresh SyncToken and try once more
    }
    const obj = must(r)
    const total = qbCents(obj.TotalAmt)
    await adopt(ctx, table, id, 'Invoice', obj, { fingerprint: fp, sentTotalCents: total })
    return { qb: obj, warning: totalWarning(inv, total) ?? extraTaxWarning(inv), unchanged: false }
  }
  return needsYou('5010', `Invoice ${inv.docNumber} kept changing in QuickBooks while we tried to update it. Press Retry.`)
}

/** A voided-by-us invoice is sent again as a new QuickBooks invoice numbered "<number>-R" (then -R2 ...). */
async function reissueAfterVoid(ctx: HandlerCtx, inv: CrmInvoice, customerRef: string, voidedQbId: string): Promise<{ qb: QbObject; warning: { code: string; message: string } | null; unchanged: boolean }> {
  const s = ctx.settings
  const table = sourceCrmTable(inv)
  const id = inv.source.id
  const marker = crmMarker('inv', id)
  const fp = fingerprintOf(invoiceFacts(inv, customerRef, s))
  for (let n = 1; n <= 6; n++) {
    const alt = { ...inv, docNumber: `${inv.docNumber.slice(0, 18)}-R${n > 1 ? n : ''}` }
    let body: Record<string, unknown>
    try {
      body = buildInvoiceBody(alt, { settings: s, customerRef })
    } catch (e) {
      if (e instanceof BuildError) return needsYou(e.code, e.message)
      throw e
    }
    const found = must(await ctx.client.query<QbObject>('Invoice', `DocNumber = ${qbQuoteLocal(String(body.DocNumber))}`, { max: 10 }))
    const ours = found.find((r) => String(r.PrivateNote ?? '').includes(marker) && !/^Voided/i.test(String(r.PrivateNote ?? '')))
    if (ours) {
      await adopt(ctx, table, id, 'Invoice', ours, { fingerprint: fp, sentTotalCents: qbCents(ours.TotalAmt) })
      const lost = await reapplyPayments(ctx, inv, voidedQbId, ours)
      return { qb: ours, warning: lost ?? totalWarning(inv, qbCents(ours.TotalAmt)) ?? extraTaxWarning(inv), unchanged: false }
    }
    if (found.length > 0) continue
    const made = await ctx.client.create<QbObject>('Invoice', body, requestIdFor(ctx.orgId, `inv:${id}`, invoiceFacts(alt, customerRef, s)))
    if (!made.ok && made.kind === 'duplicate_number') continue
    const obj = must(made)
    const total = qbCents(obj.TotalAmt)
    await adopt(ctx, table, id, 'Invoice', obj, { fingerprint: fp, sentTotalCents: total })
    const lost = await reapplyPayments(ctx, inv, voidedQbId, obj)
    return { qb: obj, warning: lost ?? totalWarning(inv, total) ?? extraTaxWarning(inv), unchanged: false }
  }
  return needsYou('6210', `Could not find a free document number to send invoice ${inv.docNumber} again. Fix the numbers in QuickBooks, then press Retry.`)
}

/**
 * Voiding a paid invoice leaves each payment in QuickBooks as an unapplied credit on the customer (QuickBooks community: "the payment stays
 * on record ... leaves a credit on the customer's account"). When the sale is reissued, the payments the CRM already sent are applied to the
 * NEW invoice, so its balance is what the CRM says is still owed. A Payment update replaces its Line list (Intuit: full update, omitted
 * writable fields become null), so the existing lines to other invoices are sent back unchanged. Idempotent: a payment already applied to the new
 * invoice is left alone; a stale SyncToken is re-read once. Returns a plain-words warning (steps included) when one could not be applied.
 */
async function reapplyPayments(ctx: HandlerCtx, inv: CrmInvoice, voidedQbId: string, fresh: QbObject): Promise<{ code: string; message: string } | null> {
  const newId = String(fresh.Id)
  const ids: string[] = []
  if (inv.source.table === 'production_jobs') {
    // org-scope-ok: the job was loaded in this company; its payments are read by job id (job payments carry no org_id of their own)
    const { data } = await ctx.admin.from('job_payments').select('id, amount_cents').eq('job_id', inv.source.id)
    for (const r of (data ?? []) as Array<{ id: string; amount_cents: number }>) if (Number(r.amount_cents) > 0) ids.push(r.id)
  } else {
    // org-scope-ok: the invoice was loaded in this company
    const { data } = await ctx.admin.from('invoice_payments').select('job_payment_id, applied_cents').eq('invoice_id', inv.source.id)
    for (const r of (data ?? []) as Array<{ job_payment_id: string; applied_cents: number }>) if (Number(r.applied_cents) > 0) ids.push(r.job_payment_id)
  }
  const problems: string[] = []
  let owes = qbCents(fresh.Balance ?? fresh.TotalAmt)
  for (const pid of Array.from(new Set(ids))) {
    const link = await ctx.links.get('job_payments', pid, 'Payment')
    if (!link) continue // not sent yet: it will apply to the live invoice when it is sent
    let done = false
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      const read = await ctx.client.read<QbObject>('Payment', link.qb_id)
      if (!read.ok) { if (attempt === 1 || !isRetryable(read.kind)) problems.push(`payment ${link.qb_id}`); continue }
      const cur = read.value
      const lines = ((cur.Line ?? []) as Array<{ Amount?: number; LinkedTxn?: Array<{ TxnId?: string }> }>)
      if (lines.some((l) => l.LinkedTxn?.some((x) => String(x.TxnId) === newId))) { done = true; break } // already applied to the new invoice
      const keep = lines.filter((l) => !l.LinkedTxn?.some((x) => String(x.TxnId) === voidedQbId))
      const used = keep.reduce((t, l) => t + qbCents(l.Amount), 0)
      const apply = Math.min(qbCents(cur.TotalAmt) - used, owes)
      if (apply <= 0) { done = true; break }
      const { MetaData: _m, UnappliedAmt: _u, sparse: _s, ...rest } = cur as Record<string, unknown>
      const body = { ...rest, Id: String(cur.Id), SyncToken: String(cur.SyncToken ?? '0'), Line: [...keep, { Amount: apply / 100, LinkedTxn: [{ TxnId: newId, TxnType: 'Invoice' }] }] }
      const r = await ctx.client.update<QbObject>('Payment', body, requestIdFor(ctx.orgId, `pay-reapply:${pid}:${newId}`, { st: cur.SyncToken, apply }))
      if (r.ok) { owes -= apply; done = true } else if (!(r.kind === 'stale' && attempt === 0)) { problems.push(`payment ${link.qb_id}`); break }
    }
    if (!done && !problems.some((x) => x.includes(link.qb_id))) problems.push(`payment ${link.qb_id}`)
  }
  if (problems.length === 0) return null
  return { code: 'payments_not_reapplied', message: `Invoice ${inv.docNumber} was sent again as ${String(fresh.DocNumber ?? '')} after the sale was restored, but the customer's earlier ${problems.join(', ')} could not be moved onto it automatically (QuickBooks left it as a credit on the customer). In QuickBooks open the customer, choose Receive payment, tick ${String(fresh.DocNumber ?? 'the new invoice')} and apply the credit, then press Skip here.` }
}

function extraTaxWarning(inv: CrmInvoice): { code: string; message: string } | null {
  return inv.extraTaxCents > 0
    ? { code: 'extra_tax', message: `Job invoice ${inv.docNumber} was sent for the sale amount. This job also has CRM invoices with $${dollars(inv.extraTaxCents).toFixed(2)} of sales tax on top that are not in QuickBooks. Add it in QuickBooks or switch to “every invoice”, then press Skip.` }
    : null
}

async function voidQbInvoice(ctx: HandlerCtx, table: string, id: string, label: string): Promise<Outcome> {
  const link = await ctx.links.get(table, id, 'Invoice')
  if (!link) return { kind: 'skipped', code: 'not_in_quickbooks', message: 'This invoice was never sent to QuickBooks, so there is nothing to void.' }
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = must(await ctx.client.read<QbObject>('Invoice', link.qb_id))
    if (/^Voided/i.test(String(cur.PrivateNote ?? '')) && qbCents(cur.TotalAmt) === 0) return { kind: 'done', qbType: 'Invoice', qbId: link.qb_id }
    const r = await ctx.client.void<QbObject>('Invoice', { Id: String(cur.Id), SyncToken: String(cur.SyncToken ?? '0') }, requestIdFor(ctx.orgId, `inv-void:${id}`, { st: cur.SyncToken }))
    if (!r.ok && r.kind === 'stale' && attempt === 0) continue
    must(r)
    // sent_total 0 = "voided by the CRM"; the fingerprint is cleared so a later upsert (undo-cancel) is never skipped as unchanged.
    await ctx.links.put({ crmTable: table, crmId: id, qbType: 'Invoice', qbId: link.qb_id, syncToken: null, sentTotalCents: 0, fingerprint: null })
    return { kind: 'done', qbType: 'Invoice', qbId: link.qb_id }
  }
  return { kind: 'needs_you', code: '5010', message: `${label} kept changing in QuickBooks while we tried to void it. Press Retry.` }
}

// ---------------------------------------------------------------- event handlers
export type EventHandler = (ctx: HandlerCtx, row: OutboxRow) => Promise<Outcome>

const done = (qbType: string, qb: QbObject, warning: { code: string; message: string } | null = null): Outcome => ({ kind: 'done', qbType, qbId: qb.Id ? String(qb.Id) : null, warning })

const customerUpserted: EventHandler = async (ctx, row) => {
  if (row.entity_table !== 'customers') return badEvent(row)
  if (before(ctx.eventDay, ctx.settings.startDate)) return { kind: 'skipped', code: 'before_start', message: 'Before your QuickBooks start date.' }
  const qbId = await ensureCustomer(ctx, row.entity_id)
  return { kind: 'done', qbType: 'Customer', qbId }
}

/** Is this job invoiced by one sale-amount invoice (roofing mode, fixed price) or by its CRM invoices? */
export function jobInvoicedBySale(mode: QbSettings['invoiceMode'], job: Pick<CrmJob, 'timeAndMaterials'>): boolean {
  return mode === 'per_job' && !job.timeAndMaterials
}

/** The invoice mode applies to NEW jobs: a job whose sale invoice is already in QuickBooks keeps its one invoice if the company switches style later. */
async function soldAsOneInvoice(ctx: HandlerCtx, job: Pick<CrmJob, 'id' | 'timeAndMaterials'>): Promise<boolean> {
  if (jobInvoicedBySale(ctx.settings.invoiceMode, job)) return true
  return !job.timeAndMaterials && !!(await ctx.links.get('production_jobs', job.id, 'Invoice'))
}

const invoiceUpserted: EventHandler = async (ctx, row) => {
  if (row.entity_table === 'production_jobs') {
    const job = await loadJob(ctx.admin, ctx.orgId, row.entity_id)
    if (!job) return needsYou('not_found', 'This job is no longer in the CRM.')
    if (!(await soldAsOneInvoice(ctx, job))) return { kind: 'skipped', code: 'mode', message: 'This job is invoiced by its CRM invoices, not by one sale invoice.' }
    if (job.status === 'cancelled') return { kind: 'skipped', code: 'cancelled', message: 'The job was cancelled.' }
    const inv = await loadJobSaleInvoice(ctx.admin, ctx.orgId, row.entity_id)
    if (!inv) return needsYou('not_found', 'This job is no longer in the CRM.')
    if (before(inv.txnDate, ctx.settings.startDate)) return { kind: 'skipped', code: 'before_start', message: 'Sold before your QuickBooks start date.' }
    if (inv.totalCents <= 0) return { kind: 'skipped', code: 'no_sale_amount', message: 'The job has no sale amount yet.' }
    const r = await syncInvoice(ctx, inv)
    return done('Invoice', r.qb, r.warning)
  }
  if (row.entity_table === 'job_invoices') {
    const inv = await loadCrmInvoice(ctx.admin, ctx.orgId, row.entity_id)
    if (!inv) return needsYou('not_found', 'This invoice is no longer in the CRM.')
    if (inv.jobId) {
      const job = await loadJob(ctx.admin, ctx.orgId, inv.jobId)
      if (job && (await soldAsOneInvoice(ctx, job))) return { kind: 'skipped', code: 'one_invoice_per_job', message: 'This job is invoiced once for its sale amount.' }
    }
    if (inv.draft) return { kind: 'skipped', code: 'draft', message: 'Drafts are not sent.' }
    if (inv.voided) return voidQbInvoice(ctx, 'job_invoices', row.entity_id, `Invoice ${inv.docNumber}`)
    if (before(inv.txnDate, ctx.settings.startDate)) return { kind: 'skipped', code: 'before_start', message: 'Dated before your QuickBooks start date.' }
    const r = await syncInvoice(ctx, inv)
    return done('Invoice', r.qb, r.warning)
  }
  return badEvent(row)
}

const invoiceVoided: EventHandler = async (ctx, row) => {
  if (row.entity_table !== 'production_jobs' && row.entity_table !== 'job_invoices') return badEvent(row)
  // State-based like every handler: if the job was restored (or the invoice is no longer void) since this was queued, do not void.
  if (row.entity_table === 'production_jobs') {
    const job = await loadJob(ctx.admin, ctx.orgId, row.entity_id)
    if (!job) return needsYou('not_found', 'This job is no longer in the CRM.')
    if (job.status !== 'cancelled') return { kind: 'skipped', code: 'not_cancelled', message: 'The job is not cancelled any more, so its invoice stays.' }
  } else {
    const inv = await loadCrmInvoice(ctx.admin, ctx.orgId, row.entity_id)
    if (!inv) return needsYou('not_found', 'This invoice is no longer in the CRM.')
    if (!inv.voided) return { kind: 'skipped', code: 'not_void', message: 'The invoice is not void any more, so it stays.' }
  }
  return voidQbInvoice(ctx, row.entity_table, row.entity_id, 'This invoice')
}

/** The QuickBooks invoice a payment lands on (created first when it is due and not there yet). */
async function invoiceForPayment(ctx: HandlerCtx, table: 'production_jobs' | 'job_invoices', id: string): Promise<QbObject> {
  const link = await ctx.links.get(table, id, 'Invoice')
  if (link) return must(await ctx.client.read<QbObject>('Invoice', link.qb_id))
  const inv = table === 'production_jobs' ? await loadJobSaleInvoice(ctx.admin, ctx.orgId, id) : await loadCrmInvoice(ctx.admin, ctx.orgId, id)
  if (!inv) return needsYou('not_found', 'The invoice this payment belongs to is no longer in the CRM.')
  if (before(inv.txnDate, ctx.settings.startDate)) {
    return needsYou('invoice_before_start', `This payment belongs to invoice ${inv.docNumber}, which is dated before your QuickBooks start date and is not matched in QuickBooks. Match that invoice first, or press Skip if the payment is already in QuickBooks.`)
  }
  if (inv.totalCents <= 0 || ('draft' in inv && (inv as { draft: boolean }).draft)) return needsYou('invoice_not_ready', `The invoice for this payment (${inv.docNumber}) is not ready to send yet.`)
  return (await syncInvoice(ctx, inv)).qb
}

const paymentHandler = (refund: 'auto' | 'disputed'): EventHandler => async (ctx, row) => {
  if (row.entity_table !== 'job_payments') return badEvent(row)
  const p = await loadPayment(ctx.admin, ctx.orgId, row.entity_id)
  if (!p) return needsYou('not_found', 'This payment is no longer in the CRM.')
  if (before(p.paidAt, ctx.settings.startDate)) return { kind: 'skipped', code: 'before_start', message: 'Paid before your QuickBooks start date.' }
  const s = ctx.settings
  const isRefund = p.amountCents < 0 || refund === 'disputed' || row.event_type !== 'payment.recorded'
  if (p.amountCents === 0) return { kind: 'skipped', code: 'zero', message: 'A $0 payment.' }

  // Already sent (an earlier run, or a re-queued row): nothing to do, and no reason to touch QuickBooks.
  const sentAs = isRefund ? 'RefundReceipt' : 'Payment'
  const sent = await ctx.links.get('job_payments', p.id, sentAs)
  if (sent) return { kind: 'done', qbType: sentAs, qbId: sent.qb_id }

  const job = p.jobId ? await loadJob(ctx.admin, ctx.orgId, p.jobId) : null
  const customerRef = await customerRefFor(ctx, { jobId: p.jobId, customerId: p.customerId ?? job?.customerId ?? null })

  if (isRefund) {
    // A voided invoice turns its payment into a customer credit in QuickBooks; a RefundReceipt on top would cut income a second time.
    const oneInvoice = !!job && (await soldAsOneInvoice(ctx, job))
    const voidedTargets = await Promise.all((job && oneInvoice ? [{ t: 'production_jobs', id: job.id }] : p.applications.map((a) => ({ t: 'job_invoices', id: a.invoiceId }))).map((x) => ctx.links.get(x.t, x.id, 'Invoice')))
    if ((job && job.status === 'cancelled') || voidedTargets.some((l) => l && l.sent_total_cents === 0)) {
      return needsYou('refund_after_void', 'This refund is for a sale that was cancelled, so its invoice is voided in QuickBooks and the customer’s payment now sits there as a credit. To record the refund: in QuickBooks open the customer, find that credit and refund it. The CRM does not post a second refund (it would count the money back twice). When that is done, press Skip.')
    }
    const body = buildRefundReceiptBody({ ...p, amountCents: Math.abs(p.amountCents) }, { settings: s, customerRef, disputed: row.event_type === 'payment.disputed' })
    const ours = await findOurs(ctx, 'RefundReceipt', crmMarker('ref', p.id), [`CustomerRef = ${qbQuoteLocal(customerRef)}`])
    if (ours) {
      await adopt(ctx, 'job_payments', p.id, 'RefundReceipt', ours)
      return done('RefundReceipt', ours)
    }
    const obj = must(await ctx.client.create<QbObject>('RefundReceipt', body, requestIdFor(ctx.orgId, `refund:${p.id}`, body)))
    await adopt(ctx, 'job_payments', p.id, 'RefundReceipt', obj)
    return done('RefundReceipt', obj)
  }

  // Which invoice(s) does it pay? One sale invoice per job (roofing), else the CRM invoices it was applied to.
  const targets: Array<{ table: 'production_jobs' | 'job_invoices'; id: string; cents: number }> = []
  if (job && (await soldAsOneInvoice(ctx, job))) targets.push({ table: 'production_jobs', id: job.id, cents: p.amountCents })
  else for (const a of p.applications) if (a.appliedCents > 0) targets.push({ table: 'job_invoices', id: a.invoiceId, cents: a.appliedCents })
  const applications: PaymentApplication[] = []
  let remaining = p.amountCents
  for (const t of targets) {
    const qbInv = await invoiceForPayment(ctx, t.table, t.id)
    // Never apply more than the invoice still owes in QuickBooks; the rest stays an unapplied payment on the customer.
    const owes = qbCents(qbInv.Balance ?? qbInv.TotalAmt)
    const cents = Math.min(t.cents, remaining, owes)
    if (cents > 0 && qbInv.Id) {
      applications.push({ invoiceQbId: String(qbInv.Id), cents })
      remaining -= cents
    }
  }
  const body = buildPaymentBody(p, { settings: s, customerRef, applications })
  const ours = await findOurs(ctx, 'Payment', crmMarker('pay', p.id), [`CustomerRef = ${qbQuoteLocal(customerRef)}`])
  if (ours) {
    await adopt(ctx, 'job_payments', p.id, 'Payment', ours)
    return done('Payment', ours)
  }
  const obj = must(await ctx.client.create<QbObject>('Payment', body, requestIdFor(ctx.orgId, `pay:${p.id}`, body)))
  const recorded = qbCents(obj.TotalAmt)
  await adopt(ctx, 'job_payments', p.id, 'Payment', obj, { sentTotalCents: recorded })
  const warning = recorded !== p.amountCents ? { code: 'total_differs', message: `QuickBooks recorded this payment as $${dollars(recorded).toFixed(2)}, the CRM says $${dollars(p.amountCents).toFixed(2)}. Ask your bookkeeper, then press Skip.` } : null
  return done('Payment', obj, warning)
}

const billRecorded: EventHandler = async (ctx, row) => {
  if (row.entity_table !== 'purchase_order_bills') return badEvent(row)
  if (!ctx.settings.bills.enabled) return { kind: 'skipped', code: 'bills_off', message: 'Vendor bills are turned off for QuickBooks.' }
  const b = await loadBill(ctx.admin, ctx.orgId, row.entity_id)
  if (!b) return needsYou('not_found', 'This bill is no longer in the CRM.')
  if (b.voided) return { kind: 'skipped', code: 'voided', message: 'This bill was voided in the CRM before it was sent.' }
  if (before(b.billDate, ctx.settings.startDate)) return { kind: 'skipped', code: 'before_start', message: 'Dated before your QuickBooks start date.' }
  const qbType = b.isCredit ? 'VendorCredit' : 'Bill'
  const kind: QbRefKind = b.isCredit ? 'cred' : 'bill'
  const link = await ctx.links.get('purchase_order_bills', b.id, qbType)
  if (link) return { kind: 'done', qbType, qbId: link.qb_id }
  const vendorRef = await ensureVendor(ctx, b.vendorId)
  const job = b.jobId ? await loadJob(ctx.admin, ctx.orgId, b.jobId) : null
  // A bill for a job lands on the job's sub-customer (job costing in QuickBooks); a job we cannot place there still posts, unassigned.
  const jobCustomerRef = job?.customerId ? await ensureJobCustomer(ctx, job) : null
  const built = buildBillBody(b, { settings: ctx.settings, vendorRef, jobCustomerRef })
  const ours = await findOurs(ctx, built.entity, crmMarker(kind, b.id), [`VendorRef = ${qbQuoteLocal(vendorRef)}`])
  if (ours) {
    await adopt(ctx, 'purchase_order_bills', b.id, qbType, ours)
    return done(qbType, ours)
  }
  const made = await ctx.client.create<QbObject>(built.entity, built.body, requestIdFor(ctx.orgId, `${kind}:${b.id}`, built.body))
  const obj = must(made)
  await adopt(ctx, 'purchase_order_bills', b.id, qbType, obj, { sentTotalCents: b.amountCents })
  const total = qbCents(obj.TotalAmt)
  return done(qbType, obj, total !== b.amountCents ? { code: 'total_differs', message: `QuickBooks recorded this bill as $${dollars(total).toFixed(2)}, the CRM says $${dollars(b.amountCents).toFixed(2)}. Ask your bookkeeper, then press Skip.` } : null)
}

/** QuickBooks bills cannot be voided by the CRM (and the CRM never deletes): a person does it, and is told which bill. */
const billVoided: EventHandler = async (ctx, row) => {
  if (row.entity_table !== 'purchase_order_bills') return badEvent(row)
  const b = await loadBill(ctx.admin, ctx.orgId, row.entity_id)
  if (!b) return needsYou('not_found', 'This bill is no longer in the CRM.')
  const qbType = b.isCredit ? 'VendorCredit' : 'Bill'
  const link = await ctx.links.get('purchase_order_bills', b.id, qbType)
  if (!link) return { kind: 'skipped', code: 'not_in_quickbooks', message: 'This bill was never sent to QuickBooks, so there is nothing to undo.' }
  return { kind: 'needs_you', code: 'bill_voided', message: `Bill ${b.billNumber ?? ''} ($${dollars(b.amountCents).toFixed(2)}) was voided in the CRM after it went to QuickBooks. The CRM never deletes in QuickBooks: delete or void that bill there, then press Skip.`.replace('  ', ' ') }
}

function badEvent(row: OutboxRow): Outcome {
  return { kind: 'needs_you', code: 'bad_event', message: `Unexpected QuickBooks event (${row.event_type} on ${row.entity_table}). Press Skip.` }
}

export const HANDLERS: Record<string, EventHandler> = {
  'customer.upserted': customerUpserted,
  'invoice.upserted': invoiceUpserted,
  'invoice.voided': invoiceVoided,
  'payment.recorded': paymentHandler('auto'),
  'payment.refunded': paymentHandler('auto'),
  'payment.disputed': paymentHandler('disputed'),
  'bill.recorded': billRecorded,
  'bill.voided': billVoided,
}

/** Run one event; any Halt becomes its outcome; an unexpected throw is a retry (never a lost event, never a guess). */
export async function runHandler(ctx: HandlerCtx, row: OutboxRow): Promise<Outcome> {
  const handler = HANDLERS[row.event_type]
  if (!handler) return { kind: 'skipped', code: 'unknown_event', message: `Nothing sends ${row.event_type} to QuickBooks.` }
  try {
    return await handler(ctx, row)
  } catch (e) {
    if (e instanceof Halt) return e.outcome
    if (e instanceof BuildError) return { kind: 'needs_you', code: e.code, message: e.message }
    console.error('quickbooks handler failed', row.event_type, e instanceof Error ? e.message : e)
    return { kind: 'retry', code: 'internal', message: 'Something went wrong on our side. This will be tried again.' }
  }
}
