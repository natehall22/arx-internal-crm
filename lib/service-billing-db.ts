/**
 * Billing recurring service — the DB side (server only). Rules: lib/service-billing.ts. The one writer of billed lines:
 * SQL create_service_invoice (migration 202611110060), which re-checks "already billed" under a per-company lock, so a
 * double tap, two office people or a retried batch never bills a visit twice. Totals and tax: computed by the ONE tax
 * calculation (lib/sales-tax.ts) and written in the same SQL call (lib/invoices.ts createServiceInvoiceFromLines). Email: sendCustomerInvoiceOnline (lib/online-payments/autopay.ts; autopay + pay link when online payments are ready).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { isUsableCustomerEmail } from '@/lib/invoice-document'
// Send = THE no-job invoice send (autopay + pay link when online payments are ready; else exactly sendCustomerInvoice).
import { sendCustomerInvoiceOnline } from '@/lib/online-payments/autopay'
import { createServiceInvoiceFromLines } from '@/lib/invoices'
import { invoicePaidCents } from '@/lib/invoice-lines'
import { jobCollections } from '@/lib/job-collection-db'
import { CANCELLED_JOB_STATUS } from '@/lib/job-status'
import { loadOrgSalesTax } from '@/lib/sales-tax-server'
import type { SalesTaxSettings } from '@/lib/sales-tax'
import {
  BILLING_LOOKBACK_DAYS,
  buildBillingUnits,
  groupDraftInvoices,
  lookbackFrom,
  monthOf,
  onlyPreviewed,
  unitWaits,
  type BillingGrouping,
  type BillingPlanFacts,
  type BillingUnit,
  type DoneVisit,
  type NotBillable,
} from '@/lib/service-billing'
import { loadCompletedServiceVisits } from '@/lib/service-plans-db'
import { ymdInZone, addDaysYmd, SERVICE_VISIT_TYPE, type BillingBasis } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'
import { isMissingColumn } from '@/lib/supabase/errors'
import { invoiceDaysOverdue } from '@/lib/payment-terms'
import type { InvoiceStatus, JobInvoice } from '@/lib/types/invoices'

const ID_CHUNK = 200
/** Invoices made per request; the screen sends a big batch in pieces and shows progress (Vercel time limits). */
export const MAX_INVOICES_PER_REQUEST = 25

export const SERVICE_BILLING_NOT_READY = 'Billing visits turns on once the database update for it is applied.'

export type BillingCustomer = { name: string; email: string | null; exempt: boolean }

export type ReadyToBill =
  | { ready: false; error: string }
  | {
      ready: true
      today: string
      currentMonth: string
      lookbackDays: number
      units: BillingUnit[]
      notBillable: NotBillable[]
      customers: Record<string, BillingCustomer>
      /** property id → one-line address */
      addresses: Record<string, string>
      salesTax: SalesTaxSettings | null
    }

export function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function notReady(error: { code?: string; message?: string } | null | undefined): boolean {
  return (
    isMissingColumn(error, 'work_order_id') ||
    isMissingColumn(error, 'billing_month') ||
    isMissingColumn(error, 'service_plan_id') ||
    isMissingColumn(error, 'customer_id') ||
    error?.code === '42P01'
  )
}

type InvoiceRef = { status?: string; org_id?: string } | null

/** Visits and plan-months already on a non-void invoice of this company. */
export async function loadBilled(admin: SupabaseClient, orgId: string, visitIds: string[], planIds: string[]): Promise<{ visitIds: Set<string>; planMonths: Set<string> } | null> {
  const visits = new Set<string>()
  const planMonths = new Set<string>()
  const live = (inv: InvoiceRef) => !!inv && inv.org_id === orgId && inv.status !== 'void'
  for (const ids of chunks(visitIds)) {
    // job_invoice_items has no org_id: the company check is the parent invoice's org_id (filtered and re-checked).
    const { data, error } = await admin
      .from('job_invoice_items')
      .select('work_order_id, job_invoices!inner(status, org_id)')
      .in('work_order_id', ids)
      .eq('job_invoices.org_id', orgId)
    if (error) {
      if (notReady(error)) return null
      throw new Error(`billing: read billed visits: ${error.message}`)
    }
    for (const r of (data ?? []) as Array<{ work_order_id: string; job_invoices: InvoiceRef }>) if (live(r.job_invoices)) visits.add(r.work_order_id)
  }
  for (const ids of chunks(planIds)) {
    const { data, error } = await admin
      .from('job_invoice_items')
      .select('service_plan_id, billing_month, job_invoices!inner(status, org_id)')
      .in('service_plan_id', ids)
      .not('billing_month', 'is', null)
      .eq('job_invoices.org_id', orgId)
    if (error) {
      if (notReady(error)) return null
      throw new Error(`billing: read billed months: ${error.message}`)
    }
    for (const r of (data ?? []) as Array<{ service_plan_id: string; billing_month: string; job_invoices: InvoiceRef }>)
      if (live(r.job_invoices)) planMonths.add(`${r.service_plan_id}|${r.billing_month}`)
  }
  return { visitIds: visits, planMonths }
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function loadPlanFacts(admin: SupabaseClient, orgId: string, planIds: string[]): Promise<Map<string, BillingPlanFacts>> {
  const out = new Map<string, BillingPlanFacts>()
  for (const ids of chunks(planIds)) {
    const { data, error } = await orgDb(admin, orgId)
      .from('service_plans')
      .select('id, name, billing_basis, price, previous_price, price_starts_on, taxable, customer_id, property_id')
      .in('id', ids)
    if (error) throw new Error(`billing: read plans: ${error.message}`)
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      out.set(String(r.id), {
        id: String(r.id),
        name: String(r.name ?? 'Service'),
        billing_basis: (r.billing_basis as BillingBasis) ?? 'per_visit',
        price: num(r.price),
        previous_price: num(r.previous_price),
        price_starts_on: (r.price_starts_on as string | null) ?? null,
        taxable: r.taxable === true,
        customer_id: String(r.customer_id),
        property_id: (r.property_id as string | null) ?? null,
      })
    }
  }
  return out
}

export async function loadCustomers(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Record<string, BillingCustomer>> {
  const out: Record<string, BillingCustomer> = {}
  for (const part of chunks(ids)) {
    let res = await orgDb(admin, orgId).from('customers').select('id, name, email, tax_exempt').in('id', part)
    if (isMissingColumn(res.error, 'tax_exempt')) res = await orgDb(admin, orgId).from('customers').select('id, name, email').in('id', part)
    if (res.error) throw new Error(`billing: read customers: ${res.error.message}`)
    for (const r of (res.data ?? []) as Array<{ id: string; name: string | null; email: string | null; tax_exempt?: boolean | null }>)
      out[r.id] = { name: r.name || 'Customer', email: isUsableCustomerEmail(r.email) ? (r.email as string).trim() : null, exempt: r.tax_exempt === true }
  }
  return out
}

export async function loadAddresses(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const part of chunks(ids)) {
    const { data, error } = await orgDb(admin, orgId).from('properties').select('id, address_text').in('id', part)
    if (error) throw new Error(`billing: read properties: ${error.message}`)
    for (const r of (data ?? []) as Array<{ id: string; address_text: string | null }>) if (r.address_text) out[r.id] = r.address_text
  }
  return out
}

/** Skipped plan visits served in [fromYmd, toYmd] — a monthly-fee plan still bills those months (lib/service-billing.ts). */
async function loadSkippedServiceVisits(admin: SupabaseClient, orgId: string, fromYmd: string, toYmd: string): Promise<DoneVisit[]> {
  const out: DoneVisit[] = []
  const PAGE = 1000
  for (let page = 0; ; page += PAGE) {
    const { data, error } = await orgDb(admin, orgId)
      .from('work_orders')
      .select('id, service_plan_id, customer_id, property_id, scheduled_date, visit_step')
      .eq('work_order_type', SERVICE_VISIT_TYPE)
      .eq('status', 'skipped')
      .gte('scheduled_date', fromYmd)
      .lte('scheduled_date', toYmd)
      .order('id')
      .range(page, page + PAGE - 1)
    if (error) throw new Error(`billing: read skipped visits: ${error.message}`)
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      if (!r.service_plan_id || !r.scheduled_date) continue
      out.push({
        visitId: String(r.id),
        planId: String(r.service_plan_id),
        customerId: (r.customer_id as string | null) ?? null,
        propertyId: (r.property_id as string | null) ?? null,
        servedOn: String(r.scheduled_date),
        visitStep: (r.visit_step as string | null) ?? 'service',
        price: null,
        taxable: false,
        skipped: true,
      })
    }
    if ((data ?? []).length < PAGE) break
  }
  return out
}

/** Everything the Ready to bill screen needs: done, unbilled units within the look-back, and the facts to preview them. */
export async function loadReadyToBill(admin: SupabaseClient, orgId: string, opts: { lookbackDays?: number; now?: Date } = {}): Promise<ReadyToBill> {
  const now = opts.now ?? new Date()
  const today = ymdInZone(now, await loadOrgTimeZone(admin, orgId))
  const lookbackDays = Math.round(opts.lookbackDays ?? BILLING_LOOKBACK_DAYS)
  const from = lookbackFrom(today, lookbackDays)
  // completed_at is a timestamp: a day of margin either side; the look-back is a convenience, not a rule.
  const [done, skipped] = await Promise.all([
    loadCompletedServiceVisits(admin, orgId, `${addDaysYmd(from, -1)}T00:00:00Z`, new Date(now.getTime() + 86_400_000).toISOString()),
    loadSkippedServiceVisits(admin, orgId, from, today),
  ])
  const visits: DoneVisit[] = [...done, ...skipped]
  const planIds = Array.from(new Set(visits.map((v) => v.planId)))
  const [plans, billed] = await Promise.all([loadPlanFacts(admin, orgId, planIds), loadBilled(admin, orgId, done.map((v) => v.visitId), planIds)])
  if (!billed) return { ready: false, error: SERVICE_BILLING_NOT_READY }
  const { units, notBillable } = buildBillingUnits(visits, plans, billed)
  const customerIds = Array.from(new Set([...units.map((u) => u.customerId), ...notBillable.map((n) => n.customerId).filter((x): x is string => !!x)]))
  const propertyIds = Array.from(new Set(units.map((u) => u.propertyId).filter((x): x is string => !!x)))
  const [customers, addresses, salesTax] = await Promise.all([
    loadCustomers(admin, orgId, customerIds),
    loadAddresses(admin, orgId, propertyIds),
    loadOrgSalesTax(admin, orgId),
  ])
  return { ready: true, today, currentMonth: monthOf(today), lookbackDays, units, notBillable, customers, addresses, salesTax }
}

export type BillRequest = {
  /** Draft keys from groupDraftInvoices (≤ MAX_INVOICES_PER_REQUEST). */
  keys: string[]
  /** What the screen showed: unit keys ('v:…' / 'm:…') and visit ids. Only these are billed. */
  unitKeys: string[]
  visitIds: string[]
  grouping: BillingGrouping
  includeCurrentMonth: boolean
  lookbackDays?: number
  /** Email each invoice to its customer now (customers without an email stay as drafts). */
  send: boolean
}

export type BillResult = {
  created: Array<{ key: string; invoiceId: string; invoiceNumber: string; customerName: string; totalCents: number; sent: boolean; sendError: string | null }>
  /** Keys with nothing left to bill (billed meanwhile, or no longer done). */
  alreadyBilled: string[]
  failed: Array<{ key: string; customerName: string; error: string }>
}

/**
 * Make the invoices for the selected drafts. Everything is recomputed here from the database — the browser only names
 * which drafts. Each invoice: create_service_invoice (idempotent) → totals + tax → optionally email.
 */
export async function createServiceInvoices(admin: SupabaseClient, orgId: string, userId: string, req: BillRequest, now = new Date()): Promise<BillResult | { error: string; status: 400 | 503 }> {
  const keys = Array.from(new Set(req.keys.filter((k) => typeof k === 'string' && k.length <= 120)))
  if (keys.length === 0) return { error: 'Pick at least one invoice to make', status: 400 }
  if (keys.length > MAX_INVOICES_PER_REQUEST) return { error: `At most ${MAX_INVOICES_PER_REQUEST} invoices at a time`, status: 400 }
  const data = await loadReadyToBill(admin, orgId, { lookbackDays: req.lookbackDays, now })
  if (!data.ready) return { error: data.error, status: 503 }
  // Bill exactly what the office previewed; anything newer waits for the next run.
  const seen = onlyPreviewed(data.units, new Set(req.unitKeys), new Set(req.visitIds))
  const open = seen.filter((u) => !unitWaits(u, req.grouping, data.currentMonth, req.includeCurrentMonth))
  const drafts = new Map(groupDraftInvoices(open, req.grouping, (id) => (id ? data.addresses[id] ?? null : null)).map((d) => [d.key, d]))
  const result: BillResult = { created: [], alreadyBilled: [], failed: [] }
  for (const key of keys) {
    const draft = drafts.get(key)
    if (!draft) {
      result.alreadyBilled.push(key)
      continue
    }
    const customer = data.customers[draft.customerId]
    const customerName = customer?.name ?? 'Customer'
    try {
      // Lines + totals (tax) in ONE SQL call, all or nothing (lib/invoices.ts createServiceInvoiceFromLines).
      const { invoiceId } = await createServiceInvoiceFromLines(admin, orgId, {
        customerId: draft.customerId,
        propertyId: draft.propertyId,
        createdBy: userId,
        lines: draft.lines,
      })
      if (!invoiceId) {
        result.alreadyBilled.push(key)
        continue
      }
      const { data: row, error: readError } = await orgDb(admin, orgId).from('job_invoices').select('*').eq('id', invoiceId).maybeSingle()
      if (readError || !row) throw new Error(readError?.message ?? 'invoice not readable after create')
      let invoice = row as JobInvoice
      let sent = false
      let sendError: string | null = null
      if (req.send) {
        if (!customer?.email) sendError = 'No email on file — left as a draft'
        else {
          try {
            const s = await sendCustomerInvoiceOnline(admin, orgId, invoice, customer.email, userId)
            if (s.ok) {
              sent = true
              invoice = s.invoice
            } else sendError = s.error
          } catch (e) {
            console.error('[billing] send failed', invoiceId, e)
            sendError = 'Email failed — left as a draft'
          }
        }
      }
      result.created.push({ key, invoiceId, invoiceNumber: invoice.invoice_number, customerName, totalCents: invoice.total_cents, sent, sendError })
    } catch (e) {
      console.error('[billing] create failed', key, e)
      result.failed.push({ key, customerName, error: 'Could not make this invoice — try again' })
    }
  }
  return result
}

/** A visit that is on a non-void invoice (its number), or null. Before migration 202611110060: never billed. */
export async function visitInvoiceNumber(admin: SupabaseClient, orgId: string, visitId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('job_invoice_items')
    .select('job_invoices!inner(invoice_number, status, org_id)')
    .eq('work_order_id', visitId)
    .eq('job_invoices.org_id', orgId)
  if (error) {
    if (notReady(error)) return null
    throw new Error(`billing: read visit invoice: ${error.message}`)
  }
  for (const r of (data ?? []) as Array<{ job_invoices: { invoice_number?: string; status?: string; org_id?: string } | null }>) {
    if (r.job_invoices && r.job_invoices.org_id === orgId && r.job_invoices.status !== 'void') return r.job_invoices.invoice_number ?? 'an invoice'
  }
  return null
}

/** Payments applied per invoice (one read shape for the Customer File list and the Today unpaid-invoices card). */
export async function loadAppliedCents(admin: SupabaseClient, invoiceIds: string[]): Promise<Map<string, number>> {
  const applied = new Map<string, number>()
  for (const ids of chunks(invoiceIds)) {
    // invoice_payments has no org_id: callers pass invoice ids they just loaded company-scoped.
    const { data: apps, error } = await admin.from('invoice_payments').select('invoice_id, applied_cents').in('invoice_id', ids)
    if (error) throw new Error(`billing: read invoice payments: ${error.message}`)
    for (const a of (apps ?? []) as Array<{ invoice_id: string; applied_cents: number }>) applied.set(a.invoice_id, (applied.get(a.invoice_id) ?? 0) + a.applied_cents)
  }
  return applied
}

export type UnpaidServiceInvoice = {
  id: string
  invoiceNumber: string
  customerId: string
  customerName: string
  /** Set on a job invoice (roofing / projects); null on a recurring-service invoice. */
  jobId: string | null
  jobNumber: string | null
  /** The invoice's job is cancelled (sold, won't be installed): still on the office's list to settle or void, never a crew's to collect. */
  jobCancelled: boolean
  dueAt: string | null
  issuedAt: string | null
  balanceCents: number
}

/** Invoices read per page / pages read for the Today card (5,000 sent invoices); past that the card says "N+". */
export const UNPAID_INVOICES_READ_CAP = 500
export const UNPAID_INVOICES_MAX_PAGES = 10

/**
 * Invoices (a job's or a recurring-service customer's) that were SENT and still owe money: status sent / partially_paid and a
 * balance above zero by the one paid rule (invoicePaidCents, so paid-before-import counts). Draft and void never count.
 * Oldest due first. Null before migration 202611110060 (no customer invoices exist yet).
 */
export async function loadUnpaidInvoices(admin: SupabaseClient, orgId: string): Promise<{ rows: UnpaidServiceInvoice[]; capped: boolean } | null> {
  // Page through the sent invoices and keep only those still owing, so settled-but-still-"sent" ones can never push a real
  // one past the read cap. Read at most UNPAID_INVOICES_MAX_PAGES pages; `capped` says there may be more.
  const open: Array<{ i: JobInvoice; balance: number }> = []
  let capped = false
  for (let page = 0; ; page++) {
    if (page >= UNPAID_INVOICES_MAX_PAGES) {
      capped = true
      break
    }
    const { data, error } = await orgDb(admin, orgId)
      .from('job_invoices')
      .select('*')
      .in('status', ['sent', 'partially_paid'])
      .order('created_at', { ascending: true })
      .order('id')
      .range(page * UNPAID_INVOICES_READ_CAP, (page + 1) * UNPAID_INVOICES_READ_CAP - 1)
    if (error) {
      if (notReady(error)) return null
      throw new Error(`billing: read unpaid invoices: ${error.message}`)
    }
    const invoices = (data ?? []) as JobInvoice[]
    const applied = await loadAppliedCents(admin, invoices.map((i) => i.id))
    for (const i of invoices) {
      const balance = i.total_cents - invoicePaidCents(i, applied.get(i.id) ?? 0)
      if (balance > 0) open.push({ i, balance })
    }
    if (invoices.length < UNPAID_INVOICES_READ_CAP) break
  }
  // Oldest due first, no due date last (sorted here so it never depends on the database's null ordering).
  open.sort((x, y) => (x.i.due_at ?? '9999').localeCompare(y.i.due_at ?? '9999') || x.i.created_at.localeCompare(y.i.created_at))
  // A job's invoices TOGETHER are never owed more than the JOB still owes by the one rule (lib/job-collection.ts): money recorded
  // on the job is often never applied to an invoice, so their own balances read too high (or open on a collected job), and two
  // open invoices on one job must not each claim the job's whole remaining. Paid in full -> gone; otherwise the job's remaining
  // is shared out oldest due first (the order every collection splits in) and an invoice left with nothing is not owed.
  // Applies to every user of this list.
  const collections = await jobCollections(admin, orgId, Array.from(new Set(open.map((x) => x.i.job_id).filter((id): id is string => !!id))))
  const left = new Map<string, number>()
  for (let k = 0; k < open.length; k++) {
    const jobId = open[k].i.job_id
    const c = jobId ? collections.get(jobId) : null
    if (!jobId || !c || (c.missingSaleAmount && !c.paidInFull)) continue // no sale amount on file: nothing to cap against
    const budget = c.paidInFull ? 0 : left.get(jobId) ?? Math.max(0, c.remainingCents)
    const take = Math.min(open[k].balance, budget)
    left.set(jobId, budget - take)
    open[k].balance = take
  }
  for (let k = open.length - 1; k >= 0; k--) if (open[k].balance <= 0) open.splice(k, 1)
  // A job invoice names its customer through the job (customer_id on the invoice itself is only set without a job).
  const jobFacts = await loadInvoiceJobFacts(admin, orgId, open.map((x) => x.i.job_id))
  const customerOf = (i: JobInvoice) => (i.job_id ? jobFacts.get(i.job_id)?.customerId : i.customer_id) ?? null
  const names = await loadCustomers(admin, orgId, Array.from(new Set(open.map((x) => customerOf(x.i)).filter((id): id is string => !!id))))
  return {
    capped,
    rows: open.map(({ i, balance }) => ({
      id: i.id,
      invoiceNumber: i.invoice_number,
      customerId: customerOf(i) ?? '',
      jobId: i.job_id ?? null,
      jobNumber: i.job_id ? jobFacts.get(i.job_id)?.jobNumber ?? null : null,
      jobCancelled: i.job_id ? jobFacts.get(i.job_id)?.cancelled === true : false,
      customerName: names[customerOf(i) ?? '']?.name ?? 'Customer',
      dueAt: i.due_at ?? null,
      issuedAt: i.issued_at ?? null,
      balanceCents: balance,
    })),
  }
}

type InvoiceJobFacts = { customerId: string | null; jobNumber: string | null; cancelled: boolean }

/** The facts of the jobs behind job invoices (customer, number, cancelled), company-scoped. One read shape for the unpaid list and the all-invoices list. */
export async function loadInvoiceJobFacts(admin: SupabaseClient, orgId: string, jobIds: Array<string | null | undefined>): Promise<Map<string, InvoiceJobFacts>> {
  const ids = Array.from(new Set(jobIds.filter((id): id is string => !!id)))
  const jobFacts = new Map<string, InvoiceJobFacts>()
  for (const part of chunks(ids)) {
    const { data, error } = await orgDb(admin, orgId).from('production_jobs').select('id, customer_id, job_number, status').in('id', part)
    if (error) throw new Error(`billing: read invoice jobs: ${error.message}`)
    for (const j of (data ?? []) as Array<{ id: string; customer_id: string | null; job_number: string | null; status: string | null }>) jobFacts.set(j.id, { customerId: j.customer_id, jobNumber: j.job_number, cancelled: j.status === CANCELLED_JOB_STATUS })
  }
  return jobFacts
}

export type InvoiceListRow = {
  id: string
  invoiceNumber: string
  customerId: string
  customerName: string
  jobId: string | null
  jobNumber: string | null
  status: InvoiceStatus
  createdAt: string
  /** The company's calendar day it was made (a draft's "date"), not the UTC day of created_at. */
  createdDay: string
  issuedAt: string | null
  dueAt: string | null
  totalCents: number
  paidCents: number
  /** Owed now: sent / partially paid invoices only (a draft or void owes nothing); a job's invoices by the job's own rule (see loadUnpaidInvoices). */
  balanceCents: number
  daysOverdue: number
}

/** Newest invoices read for the all-invoices list; past it the list says so. */
export const ALL_INVOICES_CAP = 2000

/**
 * EVERY invoice of the company (a job's and a recurring-service customer's, any status), newest first, for Billing → All
 * invoices, its export and the customer statement. What is OWED is never a second rule: an open job invoice takes the
 * unpaid list's answer (loadUnpaidInvoices, capped by what its job still owes), an open service invoice total − paid
 * (invoicePaidCents). `today` is the company's calendar day (late = a balance owed past the due day).
 */
export async function loadAllInvoices(admin: SupabaseClient, orgId: string, opts: { today: string; customerId?: string | null; cap?: number }): Promise<{ rows: InvoiceListRow[]; capped: boolean } | null> {
  const cap = opts.cap ?? ALL_INVOICES_CAP
  let invoices: JobInvoice[] = []
  const read = async (apply: (q: any) => any) => {
    const { data, error } = await apply(orgDb(admin, orgId).from('job_invoices').select('*')).order('created_at', { ascending: false }).order('id').limit(cap + 1)
    if (error) {
      if (notReady(error)) return null
      throw new Error(`billing: read invoices: ${error.message}`)
    }
    return (data ?? []) as JobInvoice[]
  }
  if (opts.customerId) {
    const mine = await read((q) => q.eq('customer_id', opts.customerId).is('job_id', null))
    if (!mine) return null
    const { data: jobs, error: jobsError } = await orgDb(admin, orgId).from('production_jobs').select('id').eq('customer_id', opts.customerId).limit(500)
    if (jobsError) throw new Error(`billing: read customer jobs: ${jobsError.message}`)
    const jobIds = ((jobs ?? []) as Array<{ id: string }>).map((j) => j.id)
    const theirs: JobInvoice[] = []
    for (const part of chunks(jobIds)) theirs.push(...((await read((q) => q.in('job_id', part))) ?? []))
    invoices = [...mine, ...theirs].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  } else {
    const all = await read((q) => q)
    if (!all) return null
    invoices = all
  }
  const capped = invoices.length > cap
  if (capped) invoices = invoices.slice(0, cap)

  const applied = await loadAppliedCents(admin, invoices.map((i) => i.id))
  const isOpen = (i: JobInvoice) => i.status === 'sent' || i.status === 'partially_paid'
  const openJobInvoices = invoices.filter((i) => isOpen(i) && i.job_id)
  const owedByJob = new Map<string, number>()
  // The unpaid list reads at most UNPAID_INVOICES_MAX_PAGES pages: past that an open job invoice missing from it is UNKNOWN, not paid.
  let unpaidCapped = false
  if (openJobInvoices.length > 0) {
    const unpaid = await loadUnpaidInvoices(admin, orgId)
    unpaidCapped = unpaid?.capped === true
    for (const r of unpaid?.rows ?? []) owedByJob.set(r.id, r.balanceCents)
  }
  const tz = await loadOrgTimeZone(admin, orgId)
  const jobFacts = await loadInvoiceJobFacts(admin, orgId, invoices.map((i) => i.job_id))
  const customerOf = (i: JobInvoice) => (i.job_id ? jobFacts.get(i.job_id)?.customerId : i.customer_id) ?? null
  const names = await loadCustomers(admin, orgId, Array.from(new Set(invoices.map(customerOf).filter((id): id is string => !!id))))
  const rows = invoices.map((i): InvoiceListRow => {
    const own = i.total_cents - invoicePaidCents(i, applied.get(i.id) ?? 0)
    const balance = !isOpen(i) ? 0 : i.job_id ? owedByJob.get(i.id) ?? (unpaidCapped ? Math.max(0, own) : 0) : Math.max(0, own)
    const paid = i.status === 'void' || i.status === 'draft' ? 0 : Math.max(0, i.total_cents - balance)
    const dueAt = i.due_at ? String(i.due_at).slice(0, 10) : null
    return {
      id: i.id,
      invoiceNumber: i.invoice_number,
      customerId: customerOf(i) ?? '',
      customerName: names[customerOf(i) ?? '']?.name ?? 'Customer',
      jobId: i.job_id ?? null,
      jobNumber: i.job_id ? jobFacts.get(i.job_id)?.jobNumber ?? null : null,
      status: i.status,
      createdAt: i.created_at,
      createdDay: ymdInZone(new Date(i.created_at), tz),
      issuedAt: i.issued_at ? String(i.issued_at).slice(0, 10) : null,
      dueAt,
      totalCents: i.total_cents,
      paidCents: paid,
      balanceCents: balance,
      daysOverdue: invoiceDaysOverdue(dueAt, opts.today, balance),
    }
  })
  return { rows, capped }
}

export type CustomerServiceInvoice = JobInvoice & { applied_cents: number; balance_cents: number }

/** A customer's invoices without a job (newest first, ≤ 200) with what's been paid, for the Customer File. */
export async function loadCustomerServiceInvoices(admin: SupabaseClient, orgId: string, customerId: string): Promise<CustomerServiceInvoice[] | null> {
  const { data, error } = await orgDb(admin, orgId)
    .from('job_invoices')
    .select('*')
    .eq('customer_id', customerId)
    .is('job_id', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    if (notReady(error)) return null
    throw new Error(`billing: read customer invoices: ${error.message}`)
  }
  const invoices = (data ?? []) as JobInvoice[]
  const applied = await loadAppliedCents(admin, invoices.map((i) => i.id))
  return invoices.map((i) => {
    const paid = invoicePaidCents(i, applied.get(i.id) ?? 0)
    return { ...i, applied_cents: paid, balance_cents: i.total_cents - paid }
  })
}
