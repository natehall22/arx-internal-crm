/**
 * What the customer portal shows (server only). RULES:
 *  - Every query goes through `orgDb(admin, orgId)` AND names the one customer (or ids loaded for that customer in this
 *    same function). Nothing here takes an id from a request without re-checking it belongs to the portal customer.
 *  - Columns are listed by name, never `*`: internal notes, costs, crew, gate codes, access notes, pricing rules,
 *    commission, other customers never leave this file.
 *  - Output types are plain view shapes; the page and the JSON routes render only these.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { invoicePaidCents } from '@/lib/invoice-lines'
import { loadOrgTrades, tradeLabel } from '@/lib/org-trades'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { cardExpired, cardLabel, loadCardOnFile } from '@/lib/online-payments/cards'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { BILLING_BASIS_LABELS, scheduleSummary, ymdInZone, type BillingBasis, type Season } from '@/lib/service-plans'
import { customerVisitIds, loadCustomerJobPhotos, loadCustomerVisitPhotos } from '@/lib/customer-visit-photos'
import { customerSignedDocPath } from '@/lib/files/files-object'
import { loadOrgProfile } from '@/lib/org-profile'
import { loadPortalCheckups, loadPortalJobs, type PortalCheckup, type PortalJob } from '@/lib/portal/job-progress'
import { resolveJobOpportunityId, resolveJobProposalId } from '@/lib/job-sold-scope'
import { isQuietJobStatus } from '@/lib/portal/job-stages'
import { loadPortalSettings } from '@/lib/portal/settings'
import { loadPortalThread } from '@/lib/threads/portal-thread'
import { orgDb } from '@/lib/supabase/org-db'
import type { PortalSession } from '@/lib/portal/server'

export type PortalVisit = { id: string; date: string | null; service: string; address: string | null; done: boolean }
export type PortalInvoice = { id: string; jobId: string | null; number: string; status: 'sent' | 'partially_paid' | 'paid'; totalCents: number; balanceCents: number; issuedAt: string | null; dueAt: string | null }
export type PortalContract = { id: string; address: string; totalCents: number; state: 'to_sign' | 'link_expired' | 'signed'; signUrl: string | null; downloadUrl: string | null; date: string }
export type PortalDocument = { id: string; title: string; kind: 'document' | 'photo'; date: string }
/** A signed change order or a shared inspection report: opens through its own existing link. */
export type PortalPaperwork = { id: string; title: string; href: string; date: string }
export type { PortalCheckup, PortalJob }
export type PortalPlan = { id: string; name: string; address: string | null; status: 'active' | 'paused'; schedule: string; price: string | null; nextVisit: string | null }
export type PortalMessage = { id: string; fromCustomer: boolean; body: string; date: string }
export type PortalCard = { available: boolean; label: string | null; autopay: boolean; expired: boolean }

export type PortalHome = {
  customerName: string
  today: string
  visits: { upcoming: PortalVisit[]; recent: PortalVisit[] }
  invoices: PortalInvoice[]
  contracts: PortalContract[]
  documents: PortalDocument[]
  paperwork: PortalPaperwork[]
  jobs: PortalJob[]
  checkups: PortalCheckup[]
  plans: PortalPlan[]
  card: PortalCard | null
  messages: PortalMessage[]
}

const MAX = { paperwork: 40, visits: 12, recent: 5, invoices: 50, contracts: 20, documents: 60, messages: 50 }
const CHUNK = 150
const chunk = <T,>(l: readonly T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < l.length; i += CHUNK) out.push(l.slice(i, i + CHUNK))
  return out
}
const money = (n: unknown): number => Math.round((Number(n) || 0) * 100)

type Rows<T> = T[]
async function soft<T>(label: string, fn: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Rows<T>> {
  const { data, error } = await fn()
  if (error) {
    console.error(`portal: ${label} unavailable:`, error.message)
    return []
  }
  return (data ?? []) as Rows<T>
}

/** The customer's own ids that other lookups hang from. */
async function ownIds(admin: SupabaseClient, orgId: string, customerId: string) {
  const db = orgDb(admin, orgId)
  const [jobs, opps, plans, props] = await Promise.all([
    soft<{ id: string; status: string | null }>('jobs', () => db.from('production_jobs').select('id, status').eq('customer_id', customerId).limit(200)),
    soft<{ id: string }>('opportunities', () => db.from('opportunities').select('id').eq('customer_id', customerId).limit(200)),
    soft<{ id: string; name: string; status: string; property_id: string | null; seasons: unknown; price: number | null; billing_basis: string; steps: unknown }>('plans', () =>
      db.from('service_plans').select('id, name, status, property_id, seasons, price, billing_basis, steps').eq('customer_id', customerId).in('status', ['active', 'paused']).limit(50)
    ),
    soft<{ id: string; label: string | null; address_text: string | null }>('properties', () => db.from('properties').select('id, label, address_text').eq('customer_id', customerId).limit(100)),
  ])
  // openJobIds: a cancelled or on-hold job shows the customer nothing of its own (documents, photos, change orders, checkups).
  return { jobIds: jobs.map((j) => j.id), openJobIds: jobs.filter((j) => !isQuietJobStatus(j.status)).map((j) => j.id), oppIds: opps.map((o) => o.id), plans, props }
}

export async function loadPortalHome(admin: SupabaseClient, s: PortalSession): Promise<PortalHome | null> {
  const { orgId, customerId } = s
  const db = orgDb(admin, orgId)
  const { data: cust } = await db.from('customers').select('id, name').eq('id', customerId).maybeSingle()
  if (!cust) return null

  const [tz, trades, ids, settings, profile] = await Promise.all([loadOrgTimeZone(admin, orgId), loadOrgTrades(admin, orgId), ownIds(admin, orgId, customerId), loadPortalSettings(admin, orgId), loadOrgProfile(admin, orgId)])
  const today = ymdInZone(new Date(), tz)
  const addressOf = new Map(ids.props.map((p) => [p.id, p.address_text || p.label || null]))
  const planName = new Map(ids.plans.map((p) => [p.id, p.name]))
  const planIds = ids.plans.map((p) => p.id)

  // ---- visits (service plan visits) ----
  const visitRows: Array<{ id: string; scheduled_date: string | null; status: string; trade: string | null; work_order_type: string | null; service_plan_id: string | null; property_id: string | null }> = []
  const wo = 'id, scheduled_date, status, trade, work_order_type, service_plan_id, property_id'
  if (planIds.length) {
    visitRows.push(...(await soft<(typeof visitRows)[number]>('plan visits', () => db.from('work_orders').select(wo).in('service_plan_id', planIds).in('status', ['scheduled', 'completed']).gte('scheduled_date', addDays(today, -60)).order('scheduled_date', { ascending: true }).limit(200))))
  }
  // A job's install days are NOT listed here: the job card shows them as "Week of ..." until they are close (lib/portal/job-stages.ts).
  const toVisit = (r: (typeof visitRows)[number]): PortalVisit => ({
    id: r.id,
    date: r.scheduled_date,
    service: (r.service_plan_id && planName.get(r.service_plan_id)) || tradeLabel(r.trade, trades),
    address: r.property_id ? addressOf.get(r.property_id) ?? null : null,
    done: r.status === 'completed',
  })
  const upcoming = visitRows.filter((r) => r.status === 'scheduled' && r.scheduled_date && r.scheduled_date >= today).sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date))).slice(0, MAX.visits).map(toVisit)
  const recent = visitRows.filter((r) => r.status === 'completed' && r.scheduled_date && r.scheduled_date <= today).sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date))).slice(0, MAX.recent).map(toVisit)

  // ---- invoices (job invoices on this customer's jobs + invoices without a job for this customer) ----
  const invCols = 'id, invoice_number, status, total_cents, paid_outside_cents, issued_at, due_at, created_at, job_id, customer_id'
  type InvRow = { id: string; job_id?: string | null; invoice_number: string; status: string; total_cents: number; paid_outside_cents?: number | null; issued_at: string | null; due_at: string | null; created_at: string }
  const own = await soft<InvRow>('service invoices', () => db.from('job_invoices').select(invCols).eq('customer_id', customerId).is('job_id', null).in('status', ['sent', 'partially_paid', 'paid']).order('created_at', { ascending: false }).limit(MAX.invoices))
  const forJobs: InvRow[] = []
  for (const part of chunk(ids.jobIds)) {
    forJobs.push(...(await soft<InvRow>('job invoices', () => db.from('job_invoices').select(invCols).in('job_id', part).in('status', ['sent', 'partially_paid', 'paid']).order('created_at', { ascending: false }).limit(MAX.invoices))))
  }
  const invRows = [...own, ...forJobs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, MAX.invoices)
  const applied = new Map<string, number>()
  for (const part of chunk(invRows.map((i) => i.id))) {
    // org-scope-ok: invoice ids were just loaded company- and customer-scoped above (invoice_payments has no org_id)
    const rows = await soft<{ invoice_id: string; applied_cents: number }>('invoice payments', () => admin.from('invoice_payments').select('invoice_id, applied_cents').in('invoice_id', part))
    for (const r of rows) applied.set(r.invoice_id, (applied.get(r.invoice_id) ?? 0) + r.applied_cents)
  }
  const invoices: PortalInvoice[] = invRows.map((i) => {
    const paid = invoicePaidCents(i as never, applied.get(i.id) ?? 0)
    const balance = Math.max(0, i.total_cents - paid)
    return { id: i.id, jobId: i.job_id ?? null, number: i.invoice_number, status: balance <= 0 ? 'paid' : (i.status as 'sent' | 'partially_paid'), totalCents: i.total_cents, balanceCents: balance, issuedAt: i.issued_at, dueAt: i.due_at }
  })

  // ---- quotes / contracts waiting to be signed, and signed copies ----
  let contracts: PortalContract[] = []
  if (ids.oppIds.length) {
    const rows = await soft<{ id: string; project_address: string; project_cost: number | null; status: string; signing_token: string; token_expires_at: string; created_at: string }>('contracts', () =>
      db.from('order_form_contracts').select('id, project_address, project_cost, status, signing_token, token_expires_at, created_at').in('opportunity_id', ids.oppIds.slice(0, CHUNK)).in('status', ['pending_customer', 'completed']).order('created_at', { ascending: false }).limit(MAX.contracts)
    )
    contracts = rows.map((c) => {
      const signed = c.status === 'completed'
      const live = Date.parse(c.token_expires_at) > Date.now()
      return {
        id: c.id,
        address: c.project_address,
        totalCents: money(c.project_cost),
        state: signed ? 'signed' : live ? 'to_sign' : 'link_expired',
        signUrl: !signed && live ? `/contracts/sign/${c.signing_token}` : null,
        downloadUrl: signed ? `/api/files/signed/contract/${c.signing_token}` : null,
        date: c.created_at,
      }
    })
  }

  // ---- documents and photos the company chose to share ----
  const documents: PortalDocument[] = []
  {
    const docCols = 'id, title, filename, created_at'
    const base = () => db.from('documents').select(docCols).eq('shared_with_customer', true).eq('status', 'active').is('deleted_at', null).order('created_at', { ascending: false }).limit(MAX.documents)
    type DocRow = { id: string; title: string | null; filename: string; created_at: string }
    for (const r of await soft<DocRow>('customer documents', () => base().eq('customer_id', customerId))) documents.push({ id: r.id, title: r.title || r.filename, kind: 'document', date: r.created_at })
    for (const part of chunk(ids.openJobIds)) {
      for (const r of await soft<DocRow>('job documents', () => base().in('job_id', part))) if (!documents.some((d) => d.id === r.id)) documents.push({ id: r.id, title: r.title || r.filename, kind: 'document', date: r.created_at })
    }
    // Photos: this customer's own service visits (the rule shared with the "done" email page) plus job photos staff chose to show
    // (lib/customer-visit-photos.ts: nothing from a job is shown by default).
    for (const r of await loadCustomerVisitPhotos(admin, orgId, await customerVisitIds(admin, orgId, customerId), { limit: MAX.documents })) documents.push({ id: r.id, title: r.caption || r.filename || 'Visit photo', kind: 'photo', date: r.created_at })
    for (const r of await loadCustomerJobPhotos(admin, orgId, ids.openJobIds, await crewPhotoJobIds(admin, orgId, customerId), { limit: MAX.documents })) if (!documents.some((d) => d.id === r.id)) documents.push({ id: r.id, title: r.caption || r.filename || 'Job photo', kind: 'photo', date: r.created_at })
    documents.sort((a, b) => b.date.localeCompare(a.date))
    documents.length = Math.min(documents.length, MAX.documents)
  }

  // ---- service plans (summary only: no crew, route, rules, internal text) ----
  const nextByPlan = new Map<string, string>()
  for (const v of visitRows) if (v.service_plan_id && v.status === 'scheduled' && v.scheduled_date && v.scheduled_date >= today) {
    const cur = nextByPlan.get(v.service_plan_id)
    if (!cur || v.scheduled_date < cur) nextByPlan.set(v.service_plan_id, v.scheduled_date)
  }
  const plans: PortalPlan[] = ids.plans.map((p) => ({
    id: p.id,
    name: p.name,
    address: p.property_id ? addressOf.get(p.property_id) ?? null : null,
    status: p.status === 'paused' ? 'paused' : 'active',
    schedule: Array.isArray(p.seasons) ? scheduleSummary(p.seasons as Season[]) : '',
    price: p.price == null ? null : `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(p.price))} ${BILLING_BASIS_LABELS[p.billing_basis as BillingBasis] ?? ''}`.trim(),
    nextVisit: nextByPlan.get(p.id) ?? null,
  }))

  // ---- saved card / autopay ----
  let card: PortalCard | null = null
  if (await isOrgFeatureOn(orgId, 'onlinePayments')) {
    const op = await loadOnlinePayments(admin, orgId)
    const c = await loadCardOnFile(admin, orgId, customerId)
    card = { available: op.ready && op.settings.autopay, label: c ? cardLabel(c) : null, autopay: !!c?.autopay, expired: c ? cardExpired(c, new Date()) : false }
  }

  // ---- jobs (progress, install days, balance), signed change orders, shared inspection reports, checkups ----
  const jobs = await loadPortalJobs(admin, orgId, customerId, {
    today,
    exactDays: settings.exactDateDays,
    terms: profile.terms,
    trades,
    oppIds: ids.oppIds,
    materialsOf: async (jobId, stored) => (await import('@/lib/supplier-orders')).loadJobMaterialsState(admin, orgId, jobId, stored),
  })
  const paperwork: PortalPaperwork[] = []
  for (const part of chunk(ids.openJobIds).slice(0, 1)) {
    for (const r of await soft<{ id: string; co_number: string; signing_token: string | null; signed_at: string | null; created_at: string }>('change orders', () =>
      db.from('job_change_orders').select('id, co_number, signing_token, signed_at, created_at').in('job_id', part).eq('status', 'completed').order('created_at', { ascending: false }).limit(MAX.paperwork)
    )) {
      if (r.signing_token && /^[0-9a-f]{64}$/i.test(r.signing_token)) paperwork.push({ id: r.id, title: `Change order ${r.co_number}`, href: customerSignedDocPath('change-order', r.signing_token), date: r.signed_at || r.created_at })
    }
  }
  // A cancelled / on-hold job's report is not shown: drop the opportunities those jobs stand on.
  const quietOpps = new Set<string>()
  const quietIds = ids.jobIds.filter((id) => !ids.openJobIds.includes(id))
  if (quietIds.length) {
    for (const j of await soft<{ id: string; project_id: string | null; linked_proposal_id: string | null; accepted_proposal_id: string | null; address_text: string | null }>('quiet jobs', () =>
      db.from('production_jobs').select('id, project_id, linked_proposal_id, accepted_proposal_id, address_text').in('id', quietIds.slice(0, CHUNK))
    )) {
      const pid = await resolveJobProposalId(admin, orgId, j).catch(() => null)
      const oid = await resolveJobOpportunityId(admin, orgId, pid, j.project_id, j.address_text).catch(() => null)
      if (oid) quietOpps.add(oid)
    }
  }
  const reportOpps = ids.oppIds.filter((id) => !quietOpps.has(id))
  if (reportOpps.length) {
    for (const r of await soft<{ id: string; share_token: string; created_at: string }>('inspection reports', () =>
      db.from('inspection_reports').select('id, share_token, created_at').in('opportunity_id', reportOpps.slice(0, CHUNK)).eq('status', 'sent').order('created_at', { ascending: false }).limit(10)
    )) {
      if (/^[0-9a-f]{64}$/i.test(r.share_token)) paperwork.push({ id: r.id, title: 'Inspection report', href: `/r/${r.share_token}`, date: r.created_at })
    }
  }
  paperwork.sort((a, b) => b.date.localeCompare(a.date))
  const checkups = await loadPortalCheckups(admin, orgId, ids.openJobIds)

  const messages = (await loadPortalThread(admin, orgId, customerId, MAX.messages)).map((m) => ({ id: m.id, fromCustomer: m.fromCustomer, body: m.body, date: m.date }))

  return { customerName: (cust as { name?: string | null }).name || '', today, visits: { upcoming, recent }, invoices, contracts, documents, paperwork, jobs, checkups, plans, card, messages }
}

/** Jobs of this customer whose crew walk-around photos staff chose to show (one tap per job). Needs migration 202611150010; before it, none. */
async function crewPhotoJobIds(admin: SupabaseClient, orgId: string, customerId: string): Promise<string[]> {
  const rows = await soft<{ id: string }>('crew photo switch', () => orgDb(admin, orgId).from('production_jobs').select('id').eq('customer_id', customerId).eq('portal_show_crew_photos', true).limit(200))
  return rows.map((r) => r.id)
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** An invoice of THIS customer (job invoice on their job, or their own), or null. The one check before download / pay. */
export async function findPortalInvoice(admin: SupabaseClient, s: PortalSession, invoiceId: string): Promise<{ id: string; job_id: string | null; status: string } | null> {
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(invoiceId)) return null
  const db = orgDb(admin, s.orgId)
  const { data } = await db.from('job_invoices').select('id, job_id, customer_id, status').eq('id', invoiceId).in('status', ['sent', 'partially_paid', 'paid']).maybeSingle()
  const inv = data as { id: string; job_id: string | null; customer_id: string | null; status: string } | null
  if (!inv) return null
  if (inv.job_id) {
    const { data: job } = await db.from('production_jobs').select('id').eq('id', inv.job_id).eq('customer_id', s.customerId).maybeSingle()
    return job ? { id: inv.id, job_id: inv.job_id, status: inv.status } : null
  }
  return inv.customer_id === s.customerId ? { id: inv.id, job_id: null, status: inv.status } : null
}

/** A shared document or photo of THIS customer: its storage path, or null. */
export async function findPortalFile(admin: SupabaseClient, s: PortalSession, kind: 'document' | 'photo', id: string): Promise<{ storagePath: string; filename: string } | null> {
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(id)) return null
  if (kind === 'document') {
    const db = orgDb(admin, s.orgId)
    const ids = await ownIds(admin, s.orgId, s.customerId)
    const { data } = await db.from('documents').select('storage_path, filename, customer_id, job_id').eq('id', id).eq('shared_with_customer', true).eq('status', 'active').is('deleted_at', null).maybeSingle()
    const d = data as { storage_path: string; filename: string; customer_id: string | null; job_id: string | null } | null
    if (!d || !(d.customer_id === s.customerId || (d.job_id && ids.openJobIds.includes(d.job_id)))) return null
    return { storagePath: d.storage_path, filename: d.filename }
  }
  const [p] = await loadCustomerVisitPhotos(admin, s.orgId, await customerVisitIds(admin, s.orgId, s.customerId), { limit: 1, photoId: id })
  if (p) return { storagePath: p.storage_path, filename: p.filename || 'photo' }
  const own = await ownIds(admin, s.orgId, s.customerId)
  const [jp] = await loadCustomerJobPhotos(admin, s.orgId, own.openJobIds, await crewPhotoJobIds(admin, s.orgId, s.customerId), { limit: 1, photoId: id })
  return jp ? { storagePath: jp.storage_path, filename: jp.filename || 'photo' } : null
}
