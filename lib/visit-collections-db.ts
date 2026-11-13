/**
 * Server side of "what the customer owes" and "collected at the door" (rules: lib/visit-collections.ts).
 *
 *  - Owed: ALL the customer's open invoices (job invoices and recurring-service invoices), by the one unpaid rule
 *    (lib/service-billing-db.ts loadUnpaidInvoices), oldest due first. A crew sees only the total, never a price line.
 *  - A crew's cash / check is a PENDING row in `visit_collections` (service role only). It counts nowhere until the office
 *    confirms; the confirm writes real payments, one per invoice it pays, each with an idempotency key — so a confirm can be
 *    retried safely. A service invoice goes through `recordCustomerInvoicePayment`; a JOB invoice through
 *    `recordJobInvoicePayment` (recordJobPayment: outbox, paid-in-full, commission sync; then the locked apply).
 *  - The split across invoices is decided once and stored on the row before anything is written, so a retry after a partial
 *    failure finishes the same split instead of recomputing it from balances that already moved.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { applyPaymentToInvoice, findOrgInvoice, recordCustomerInvoicePayment } from '@/lib/invoices'
import { recordJobInvoicePayment } from '@/lib/job-invoice-payment'
import { ymdInZone } from '@/lib/service-plans'
import { loadUnpaidInvoices } from '@/lib/service-billing-db'
import { orgDb } from '@/lib/supabase/org-db'
import { allocateCollection, summarizeOwed, type CollectionInput, type CrewMoney, type OpenInvoice, type OwedSummary } from '@/lib/visit-collections'

/** Cash / checks a crew may leave waiting for the office on one customer at a time. */
export const MAX_PENDING_PER_CUSTOMER = 5

/** Owed + waiting for each customer (a customer with nothing open is absent). Before the migrations: empty. */
export async function loadOwedByCustomer(admin: SupabaseClient, orgId: string, customerIds: string[]): Promise<Map<string, OwedSummary>> {
  const out = new Map<string, OwedSummary>()
  const ids = Array.from(new Set(customerIds.filter(Boolean)))
  if (ids.length === 0) return out
  const loaded = await loadUnpaidInvoices(admin, orgId)
  const byCustomer = new Map<string, OpenInvoice[]>()
  for (const r of loaded?.rows ?? []) {
    if (!ids.includes(r.customerId)) continue
    byCustomer.set(r.customerId, [...(byCustomer.get(r.customerId) ?? []), { id: r.id, number: r.invoiceNumber, balanceCents: r.balanceCents, jobId: r.jobId }])
  }
  const pending = await pendingCentsByCustomer(admin, orgId, ids)
  for (const [customerId, invoices] of Array.from(byCustomer.entries())) out.set(customerId, summarizeOwed(invoices, pending.get(customerId) ?? 0))
  return out
}

async function pendingCentsByCustomer(admin: SupabaseClient, orgId: string, customerIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const { data, error } = await orgDb(admin, orgId).from('visit_collections').select('customer_id, amount_cents').eq('status', 'pending').in('customer_id', customerIds)
  if (error) return out // table not there yet: nothing is waiting
  for (const r of (data ?? []) as Array<{ customer_id: string; amount_cents: number }>) out.set(r.customer_id, (out.get(r.customer_id) ?? 0) + r.amount_cents)
  return out
}

export type RecordCollectionResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; status: 400 | 409 | 503; error: string }

/** A crew writes down cash / a check. Pending until the office confirms. A resend with the same tap id returns the first row. */
export async function recordPendingCollection(
  admin: SupabaseClient,
  orgId: string,
  c: { subId: string; visitId: string; customerId: string; input: CollectionInput }
): Promise<RecordCollectionResult> {
  const owed = (await loadOwedByCustomer(admin, orgId, [c.customerId])).get(c.customerId)
  if (!owed || owed.totalCents <= 0) return { ok: false, status: 409, error: 'This customer has nothing open to pay.' }
  if (c.input.amountCents > owed.dueCents) {
    return { ok: false, status: 400, error: owed.pendingCents > 0 ? 'That is more than is still owed (some is already waiting for the office).' : 'That is more than the customer owes.' }
  }
  const db = orgDb(admin, orgId)
  const { count } = await db.from('visit_collections').select('id', { count: 'exact', head: true }).eq('customer_id', c.customerId).eq('status', 'pending')
  if ((count ?? 0) >= MAX_PENDING_PER_CUSTOMER) return { ok: false, status: 409, error: 'The office needs to confirm the earlier ones first.' }
  const { data, error } = await db
    .from('visit_collections')
    .insert({
      work_order_id: c.visitId,
      customer_id: c.customerId,
      amount_cents: c.input.amountCents,
      method: c.input.method,
      check_number: c.input.checkNumber,
      note: c.input.note,
      collected_by_sub_id: c.subId,
      client_tap_id: c.input.tapId,
      status: 'pending',
      collected_at: new Date().toISOString(),
      payments: [],
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505' && c.input.tapId) {
      const { data: first } = await db.from('visit_collections').select('id').eq('client_tap_id', c.input.tapId).maybeSingle()
      if (first) return { ok: true, id: (first as { id: string }).id, duplicate: true }
    }
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: false, status: 503, error: 'Collecting at the door is not set up yet.' }
    console.error('[visit-collections] insert failed', error)
    return { ok: false, status: 400, error: 'Could not save that. Try again.' }
  }
  return { ok: true, id: (data as { id: string }).id, duplicate: false }
}

export type PendingCollection = {
  id: string
  customerId: string
  customerName: string
  crewName: string | null
  amountCents: number
  method: 'cash' | 'check'
  checkNumber: string | null
  note: string | null
  collectedAt: string
  /** Address of the visit it was taken at, when the visit still exists. */
  address: string | null
}

/** Collections waiting for the office, oldest first. Empty before the migration. */
export async function loadPendingCollections(admin: SupabaseClient, orgId: string, limit = 100): Promise<PendingCollection[]> {
  const db = orgDb(admin, orgId)
  const { data, error } = await db
    .from('visit_collections')
    .select('id, customer_id, work_order_id, amount_cents, method, check_number, note, collected_at, collected_by_sub_id')
    .eq('status', 'pending')
    .order('collected_at')
    .limit(limit)
  if (error) return []
  const rows = (data ?? []) as Array<{ id: string; customer_id: string; work_order_id: string | null; amount_cents: number; method: 'cash' | 'check'; check_number: string | null; note: string | null; collected_at: string; collected_by_sub_id: string | null }>
  if (rows.length === 0) return []
  const uniq = (xs: Array<string | null>) => Array.from(new Set(xs.filter((x): x is string => !!x)))
  const [custs, subs, visits] = await Promise.all([
    db.from('customers').select('id, name').in('id', uniq(rows.map((r) => r.customer_id))),
    db.from('sub_contractors').select('id, company_name').in('id', uniq(rows.map((r) => r.collected_by_sub_id))),
    db.from('work_orders').select('id, address').in('id', uniq(rows.map((r) => r.work_order_id))),
  ])
  const cn = new Map(((custs.data ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]))
  const sn = new Map(((subs.data ?? []) as Array<{ id: string; company_name: string | null }>).map((s) => [s.id, s.company_name]))
  const va = new Map(((visits.data ?? []) as Array<{ id: string; address: string | null }>).map((v) => [v.id, v.address]))
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: cn.get(r.customer_id) ?? 'Customer',
    crewName: r.collected_by_sub_id ? (sn.get(r.collected_by_sub_id) ?? null) : null,
    amountCents: r.amount_cents,
    method: r.method,
    checkNumber: r.check_number,
    note: r.note,
    collectedAt: r.collected_at,
    address: r.work_order_id ? (va.get(r.work_order_id) ?? null) : null,
  }))
}

export type DecideResult = { ok: true } | { ok: false; status: 404 | 409 | 500; error: string }

type Row = { id: string; customer_id: string; amount_cents: number; method: 'cash' | 'check'; check_number: string | null; status: string; collected_at: string; payments: unknown }
/** `job_id` is stored with the split so a retry pays a job invoice the job way even after balances moved (absent = service). */
type Part = { invoice_id: string; cents: number; payment_id: string | null; job_id?: string | null }

/**
 * The office confirms: the money becomes real. Splits across the customer's open invoices oldest first (stored on the row
 * first), writes one payment per invoice through the invoice payment writer (idempotent by collection + invoice), then marks
 * the row confirmed. Refused when the customer's invoices no longer owe that much (reject it, or fix the invoices).
 */
export async function confirmCollection(admin: SupabaseClient, orgId: string, userId: string, id: string): Promise<DecideResult> {
  const db = orgDb(admin, orgId)
  const { data } = await db.from('visit_collections').select('id, customer_id, amount_cents, method, check_number, status, collected_at, payments').eq('id', id).maybeSingle()
  const row = data as Row | null
  if (!row) return { ok: false, status: 404, error: 'Not found' }
  if (row.status !== 'pending') return { ok: false, status: 409, error: 'This one was already handled.' }

  const stored: Part[] = Array.isArray(row.payments) ? (row.payments as Part[]).filter((p) => p && typeof p.invoice_id === 'string' && Number.isInteger(p.cents)) : []
  let parts: Part[] = stored
  const splitCents = stored.reduce((sum, p) => sum + p.cents, 0)
  if (splitCents < row.amount_cents) {
    // Decide the split now (pending collections are excluded from "owed" for OTHER crews, so count this one back in). After a
    // failed part was dropped (below), only the rest is split again, never onto an invoice this collection already paid.
    const owed = (await loadOwedByCustomer(admin, orgId, [row.customer_id])).get(row.customer_id)
    const paidHere = new Set(stored.map((p) => p.invoice_id))
    const open = (owed?.invoices ?? []).filter((i) => !paidHere.has(i.id))
    const jobOf = new Map(open.map((i) => [i.id, i.jobId ?? null]))
    const split = allocateCollection(row.amount_cents - splitCents, open)
    if (split.parts.length === 0 || split.leftoverCents > 0) {
      return { ok: false, status: 409, error: 'The customer’s invoices don’t owe this much any more. Reject it, or check the invoices first.' }
    }
    parts = [...stored, ...split.parts.map((p) => ({ invoice_id: p.invoiceId, cents: p.cents, payment_id: null, job_id: jobOf.get(p.invoiceId) ?? null }))]
    // Compare-and-set on the split as read: two confirms at once (double tap, two people) must not each write their own split —
    // the second would see the first one's payment already lowering a balance and pay a DIFFERENT invoice (money twice).
    const { data: claimed, error } = await db.from('visit_collections').update({ payments: parts }).eq('id', id).eq('status', 'pending').eq('payments', JSON.stringify(row.payments ?? [])).select('id')
    if (error) return { ok: false, status: 500, error: 'Could not save. Try again.' }
    if (!claimed || claimed.length === 0) return { ok: false, status: 409, error: 'Someone else is confirming this one. Refresh and check.' }
  }

  const day = ymdInZone(new Date(row.collected_at), await loadOrgTimeZone(admin, orgId))
  const note = row.method === 'check' ? `Collected by the crew at the door${row.check_number ? ` · check #${row.check_number}` : ''}` : 'Collected by the crew at the door'
  for (const part of parts) {
    if (part.payment_id) continue
    const r = await payPart(admin, orgId, part, { day, method: row.method, note, userId, key: `visit-collection:${row.id}:${part.invoice_id}` })
    if (!r.ok) {
      // A job payment that was saved but not yet applied to its invoice is real money: keep the stored split so a retry
      // finds that payment by its key and applies it, instead of splitting again (which would pay the customer's invoices twice).
      if (r.status === 500) return { ok: false, status: 500, error: r.error }
      // The writer refused and wrote nothing for this part (one SQL transaction). Drop it and every later unwritten part, so
      // a retry splits what is left over the invoices as they are then, instead of retrying a refused part forever (which,
      // once an earlier part is real money, could neither be confirmed nor rejected).
      const kept = parts.slice(0, parts.indexOf(part)).filter((p) => p.payment_id)
      await db.from('visit_collections').update({ payments: kept }).eq('id', id).eq('status', 'pending')
      return { ok: false, status: 409, error: r.error }
    }
    part.payment_id = r.paymentId
    // Remember it now: a reject must see that real money was already written, and a retry must not redo this part.
    await db.from('visit_collections').update({ payments: parts }).eq('id', id).eq('status', 'pending')
  }
  const { data: done } = await db
    .from('visit_collections')
    .update({ status: 'confirmed', decided_by: userId, decided_at: new Date().toISOString(), payments: parts })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (!done || done.length === 0) return { ok: false, status: 409, error: 'This one was already handled.' }
  return { ok: true }
}

type PartResult = { ok: true; paymentId: string } | { ok: false; status: number; error: string }

/** One part of a split, through the ONE writer for that kind of invoice. Idempotent by `key` for both kinds. */
async function payPart(
  admin: SupabaseClient,
  orgId: string,
  part: Part,
  c: { day: string; method: 'cash' | 'check'; note: string; userId: string; key: string }
): Promise<PartResult> {
  if (!part.job_id) {
    const r = await recordCustomerInvoicePayment(admin, orgId, part.invoice_id, { amountCents: part.cents, paidAt: c.day, method: c.method, note: c.note, createdBy: c.userId, idempotencyKey: c.key })
    return r.ok ? { ok: true, paymentId: r.paymentId } : { ok: false, status: r.status, error: r.error }
  }
  const invoice = await findOrgInvoice(admin, part.invoice_id, orgId)
  if (!invoice || invoice.job_id !== part.job_id) return { ok: false, status: 404, error: 'That invoice is not there any more.' }
  // A retry after a crash: the job payment may already exist under this key (even fully applied, when "already paid" would
  // wrongly refuse a second call). Find it and make sure it is applied (a repeat apply is a no-op).
  // org-scope-ok: part.job_id was just verified in this company through findOrgInvoice above
  const { data: first } = await admin.from('job_payments').select('id').eq('job_id', part.job_id).eq('idempotency_key', c.key).maybeSingle()
  const existing = (first as { id: string } | null)?.id
  if (existing) {
    try {
      await applyPaymentToInvoice(admin, orgId, part.invoice_id, existing, part.cents, c.userId)
    } catch (e) {
      console.error('[visit-collections] saved job payment could not be applied', part.invoice_id, (e as Error).message)
      return { ok: false, status: 500, error: 'The payment was saved but could not be applied to its invoice. Try confirming again.' }
    }
    return { ok: true, paymentId: existing }
  }
  const r = await recordJobInvoicePayment(admin, orgId, { id: invoice.id, job_id: part.job_id, status: invoice.status }, {
    amountCents: part.cents,
    paidAt: c.day,
    method: c.method,
    note: c.note,
    createdBy: c.userId,
    idempotencyKey: c.key,
  })
  return r.ok ? { ok: true, paymentId: r.paymentId } : { ok: false, status: r.status, error: r.error }
}

/** The office says no (money never arrived, wrong customer, …). Nothing was written, so there is nothing to undo. */
export async function rejectCollection(admin: SupabaseClient, orgId: string, userId: string, id: string, reason: string | null): Promise<DecideResult> {
  const db = orgDb(admin, orgId)
  const { data: found } = await db.from('visit_collections').select('id, status, payments').eq('id', id).maybeSingle()
  const row = found as { id: string; status: string; payments: unknown } | null
  if (!row) return { ok: false, status: 404, error: 'Not found' }
  if (row.status !== 'pending') return { ok: false, status: 409, error: 'This one was already handled.' }
  // A confirm that got part-way wrote real payments: it must be finished (confirmed), not thrown away. A confirm that has only
  // stored its split may be writing a payment right now, so that is refused too (a refused part clears the split again).
  if (Array.isArray(row.payments) && row.payments.length > 0) {
    return { ok: false, status: 409, error: (row.payments as Part[]).some((p) => p && p.payment_id) ? 'Part of this is already recorded. Confirm it to finish.' : 'Someone is confirming this one. Refresh and check.' }
  }
  // Compare-and-set on "no split yet": a confirm that claims the split after the read above wins, and this reject stops.
  const { data } = await db
    .from('visit_collections')
    .update({ status: 'rejected', decided_by: userId, decided_at: new Date().toISOString(), reject_reason: reason?.trim().slice(0, 500) || null })
    .eq('id', id)
    .eq('status', 'pending')
    .eq('payments', '[]')
    .select('id')
  if (!data || data.length === 0) return { ok: false, status: 409, error: 'This one was already handled.' }
  return { ok: true }
}

export async function loadCrewMoney(admin: SupabaseClient, orgId: string, visits: Array<{ id: string; customerId: string | null }>): Promise<Record<string, CrewMoney>> {
  const owed = await loadOwedByCustomer(admin, orgId, visits.map((v) => v.customerId).filter((x): x is string => !!x))
  const { loadOnlinePayments } = await import('@/lib/online-payments/accounts')
  const online = owed.size > 0 ? (await loadOnlinePayments(admin, orgId).catch(() => null))?.ready === true : false
  const out: Record<string, CrewMoney> = {}
  for (const v of visits) {
    const o = v.customerId ? owed.get(v.customerId) : undefined
    if (o && (o.dueCents > 0 || o.pendingCents > 0)) out[v.id] = { dueCents: o.dueCents, pendingCents: o.pendingCents, canPayOnline: online && o.dueCents > 0 }
  }
  return out
}

/** The invoice a pay link / QR is for: the customer's oldest open invoice (job or service). */
export async function oldestOpenInvoice(admin: SupabaseClient, orgId: string, customerId: string): Promise<OpenInvoice | null> {
  return (await loadOwedByCustomer(admin, orgId, [customerId])).get(customerId)?.invoices[0] ?? null
}
