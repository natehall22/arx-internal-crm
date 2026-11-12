/**
 * Backfill, link-first (PR4). A company that already uses QuickBooks has customers, jobs and invoices there. Before the worker
 * sends anything, this finds what is ALREADY in QuickBooks and links it (`qb_links`), so the worker finds instead of duplicating.
 *   1. `planBackfill` — read-only: pulls QuickBooks customers / sub-customers / invoices and matches each CRM record:
 *      customers by the CRM's one identity rule (lib/quickbooks/identity.ts -> `matchExistingCustomer`: email, phone, name+address),
 *      jobs by job number under the matched customer, invoices by DocNumber. One clear match = "certain"; more than one,
 *      two CRM records for one QuickBooks record, or a different amount = "ambiguous" (the owner decides); nothing = "none".
 *   2. `applyBackfill` — writes links only for certain matches and the owner's explicit choices. It re-plans on the server (the
 *      browser's copy is never trusted). It creates NOTHING in QuickBooks: whatever has no match is created later, by the worker,
 *      from the start date on (find-before-send), so no history before the start date is ever created.
 * Company-scoped throughout (orgDb + the company's own QuickBooks client).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { mergeOrgSettings } from '@/lib/org-settings'
import { orgDb } from '@/lib/supabase/org-db'

import { centsOf } from './builders'
import type { QbClient, QbObject } from './client'
import { qbQuote } from './client'
import { matchingQbCustomers } from './identity'
import { createQbLinks, type QbLinks } from './links'
import { QUICKBOOKS_SETTINGS_KEY, type QbSettings } from './mapping'
import { sweepUnheard, type SweepResult } from './sweep'

const PAGE = 1000
const MAX_PAGES = 10
const MAX_CRM = 3000

export type Candidate = { qbId: string; label: string; detail: string }
export type MatchState = 'certain' | 'ambiguous' | 'none'
export type MatchItem = {
  /** `customer:<id>` | `job:<id>` | `invoice:<table>:<id>` — what the owner's answer refers to. */
  key: string
  kind: 'customer' | 'job' | 'invoice'
  crmTable: 'customers' | 'production_jobs' | 'job_invoices'
  crmId: string
  label: string
  state: MatchState
  reason: string | null
  candidates: Candidate[]
  /** Set when the owner picked one of the candidates. */
  chosen: string | null
}
export type BackfillPlan = {
  items: MatchItem[]
  counts: { alreadyLinked: number; certain: number; ambiguous: number; none: number }
  qb: { customers: number; jobs: number; invoices: number }
  /** What the worker will create from the start date on (nothing earlier). */
  willSend: SweepResult
  truncated: boolean
}
/** key -> a candidate's QuickBooks id, or 'none' (create a new one later instead of linking). */
export type Decisions = Record<string, string>

async function pullAll(client: QbClient, entity: 'Customer' | 'Invoice', where: string | null): Promise<{ rows: QbObject[]; truncated: boolean }> {
  const rows: QbObject[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await client.query<QbObject>(entity, where, { max: PAGE, start: page * PAGE + 1 })
    if (!r.ok) throw new Error(`QuickBooks ${entity} list could not be read (${r.kind})`)
    rows.push(...r.value)
    if (r.value.length < PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

const cents = (v: unknown) => centsOf(Number(v) || 0)
const money = (c: number) => `$${(c / 100).toFixed(2)}`
const tokenRe = (t: string) => new RegExp(`(^|[^A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i')
const cand = (q: QbObject, detail: string): Candidate => ({ qbId: String(q.Id), label: String(q.DisplayName ?? q.DocNumber ?? q.Id), detail })

type CrmCust = { id: string; name: string; email: string | null; phone: string | null; addressText: string | null }
type CrmJobRow = { id: string; customerId: string; jobNumber: string; saleCents: number }
type CrmInvRow = { table: 'production_jobs' | 'job_invoices'; id: string; docNumber: string; totalCents: number; customerId: string | null; label: string }

export async function planBackfill(
  admin: SupabaseClient,
  orgId: string,
  client: QbClient,
  settings: QbSettings,
  decisions: Decisions = {},
  links: QbLinks = createQbLinks(admin, orgId)
): Promise<BackfillPlan> {
  const db = orgDb(admin, orgId)

  // ---- QuickBooks side (read only)
  const qbCust = await pullAll(client, 'Customer', null)
  const qbInv = await pullAll(client, 'Invoice', null)
  const qbJobs = qbCust.rows.filter((c) => c.Job === true)
  const qbPeople = qbCust.rows.filter((c) => c.Job !== true)

  // ---- what is already linked (these are never touched)
  const { data: linkRows } = await db.from('qb_links').select('crm_table, crm_id, qb_type, qb_id').limit(50000)
  const linked = (linkRows ?? []) as Array<{ crm_table: string; crm_id: string; qb_type: string; qb_id: string }>
  const held = (type: string) => new Set(linked.filter((l) => l.qb_type === type).map((l) => l.qb_id))
  const linkedCrm = (table: string, type: string) => new Map(linked.filter((l) => l.crm_table === table && l.qb_type === type).map((l) => [l.crm_id, l.qb_id]))
  const custLinks = linkedCrm('customers', 'Customer')
  const jobLinks = linkedCrm('production_jobs', 'Customer')
  const invLinks = new Set(linked.filter((l) => l.qb_type === 'Invoice').map((l) => `${l.crm_table}:${l.crm_id}`))

  // ---- CRM side: only records that can ever be sent (a job with money, an issued invoice)
  const { data: jobData } = await db.from('production_jobs').select('id, customer_id, job_number, sale_amount').neq('status', 'cancelled').not('customer_id', 'is', null).limit(MAX_CRM)
  const jobs: CrmJobRow[] = ((jobData ?? []) as Array<Record<string, unknown>>).map((j) => ({ id: String(j.id), customerId: String(j.customer_id), jobNumber: String(j.job_number ?? ''), saleCents: cents(j.sale_amount) }))
  const { data: invData } = await db.from('job_invoices').select('id, invoice_number, total_cents, customer_id, job_id, status').in('status', ['sent', 'partially_paid', 'paid']).limit(MAX_CRM)
  const invRows = (invData ?? []) as Array<Record<string, unknown>>
  const jobCustomer = new Map(jobs.map((j) => [j.id, j.customerId]))
  const crmInvoices: CrmInvRow[] = []
  if (settings.invoiceMode === 'per_job') for (const j of jobs.filter((x) => x.saleCents > 0 && x.jobNumber)) crmInvoices.push({ table: 'production_jobs', id: j.id, docNumber: j.jobNumber, totalCents: j.saleCents, customerId: j.customerId, label: `Job ${j.jobNumber}` })
  for (const r of invRows) {
    const jobId = r.job_id ? String(r.job_id) : null
    // In per-job mode an invoice that hangs off a job is part of that job's one QuickBooks invoice (the worker sends it only for T&M / no-job); matching it here by number is still harmless.
    crmInvoices.push({ table: 'job_invoices', id: String(r.id), docNumber: String(r.invoice_number ?? ''), totalCents: Number(r.total_cents) || 0, customerId: r.customer_id ? String(r.customer_id) : jobId ? jobCustomer.get(jobId) ?? null : null, label: `Invoice ${r.invoice_number ?? String(r.id).slice(0, 8)}` })
  }
  const customerIds = Array.from(new Set([...jobs.map((j) => j.customerId), ...crmInvoices.map((i) => i.customerId).filter((x): x is string => !!x)])).slice(0, MAX_CRM)
  const customers: CrmCust[] = []
  for (let i = 0; i < customerIds.length; i += 200) {
    const { data } = await db.from('customers').select('id, name, email, phone, address_text').in('id', customerIds.slice(i, i + 200))
    for (const r of (data ?? []) as Array<Record<string, unknown>>) customers.push({ id: String(r.id), name: String(r.name ?? ''), email: (r.email as string) ?? null, phone: (r.phone as string) ?? null, addressText: (r.address_text as string) ?? null })
  }

  const items: MatchItem[] = []
  const counts = { alreadyLinked: 0, certain: 0, ambiguous: 0, none: 0 }
  const push = (it: Omit<MatchItem, 'chosen'> & { chosen?: string | null }) => {
    const item: MatchItem = { chosen: null, ...it }
    // The owner's answer, only ever one of the offered candidates (or "none").
    const d = decisions[item.key]
    if (item.state === 'ambiguous' && d) {
      if (d === 'none') {
        item.state = 'none'
        item.reason = 'You chose not to link it; it will be created later.'
        item.candidates = []
      } else if (item.candidates.some((c) => c.qbId === d)) {
        item.state = 'certain'
        item.chosen = d
        item.candidates = item.candidates.filter((c) => c.qbId === d)
      }
    }
    items.push(item)
    counts[item.state]++
    return item
  }

  // ---- customers: the CRM's one identity rule
  const freeCust = qbPeople.filter((q) => !held('Customer').has(String(q.Id)))
  const custOutcome = new Map<string, string | null>() // crm customer id -> QuickBooks id it will be linked to
  const draft = customers
    .filter((c) => !custLinks.has(c.id))
    .map((c) => ({ c, hits: matchingQbCustomers({ name: c.name, email: c.email, phone: c.phone, addressText: c.addressText }, freeCust) }))
  const claimed = new Map<string, number>()
  for (const d of draft) if (d.hits.length === 1) claimed.set(String(d.hits[0].Id), (claimed.get(String(d.hits[0].Id)) ?? 0) + 1)
  for (const { c, hits } of draft) {
    const base = { key: `customer:${c.id}`, kind: 'customer' as const, crmTable: 'customers' as const, crmId: c.id, label: c.name || 'Customer' }
    const detail = (q: QbObject) => [q.PrimaryEmailAddr?.Address, q.PrimaryPhone?.FreeFormNumber, q.BillAddr?.Line1].filter(Boolean).join(' · ') || 'no contact details'
    let it: MatchItem
    if (hits.length === 0) it = push({ ...base, state: 'none', reason: 'Not in QuickBooks yet. It will be created when its first invoice is sent (from the start date on).', candidates: [] })
    else if (hits.length > 1) it = push({ ...base, state: 'ambiguous', reason: 'More than one QuickBooks customer fits. Pick the right one.', candidates: hits.map((q) => cand(q, detail(q))) })
    else if ((claimed.get(String(hits[0].Id)) ?? 0) > 1) it = push({ ...base, state: 'ambiguous', reason: 'Two CRM customers fit the same QuickBooks customer. Say which one it is.', candidates: [cand(hits[0], detail(hits[0]))] })
    else it = push({ ...base, state: 'certain', reason: null, candidates: [cand(hits[0], detail(hits[0]))] })
    custOutcome.set(c.id, it.state === 'certain' ? it.candidates[0].qbId : null)
  }
  // Two customers both "chosen" onto one QuickBooks record must not both link: the first wins, the other goes back to the owner.
  const seen = new Set<string>()
  for (const it of items.filter((i) => i.kind === 'customer' && i.state === 'certain')) {
    const q = it.candidates[0].qbId
    if (seen.has(q)) {
      counts.certain--
      counts.ambiguous++
      it.state = 'ambiguous'
      it.chosen = null
      it.reason = 'Another CRM customer is already matched to this QuickBooks customer.'
      custOutcome.set(it.crmId, null)
    } else seen.add(q)
  }

  // ---- jobs: sub-customer under the matched customer whose name carries the job number
  const parentOf = (customerId: string): string | null => custLinks.get(customerId) ?? custOutcome.get(customerId) ?? null
  const freeJobs = qbJobs.filter((q) => !held('Customer').has(String(q.Id)))
  const jobOutcome = new Map<string, string | null>()
  for (const j of jobs) {
    if (jobLinks.has(j.id)) { counts.alreadyLinked++; jobOutcome.set(j.id, jobLinks.get(j.id)!); continue }
    const parent = parentOf(j.customerId)
    const base = { key: `job:${j.id}`, kind: 'job' as const, crmTable: 'production_jobs' as const, crmId: j.id, label: `Job ${j.jobNumber}` }
    if (!parent || !j.jobNumber) { push({ ...base, state: 'none', reason: parent ? 'No job number to match on.' : 'Its customer is not matched to QuickBooks yet.', candidates: [] }); continue }
    const hits = freeJobs.filter((q) => String(q.ParentRef?.value) === parent && tokenRe(j.jobNumber).test(String(q.DisplayName ?? '')))
    const it = hits.length === 0 ? push({ ...base, state: 'none', reason: 'No QuickBooks job with this number. It will be created with its first invoice (from the start date on).', candidates: [] })
      : hits.length === 1 ? push({ ...base, state: 'certain', reason: null, candidates: [cand(hits[0], 'job under the matched customer')] })
      : push({ ...base, state: 'ambiguous', reason: 'More than one QuickBooks job carries this number.', candidates: hits.map((q) => cand(q, 'job under the matched customer')) })
    jobOutcome.set(j.id, it.state === 'certain' ? it.candidates[0].qbId : null)
  }
  for (const c of customers) if (custLinks.has(c.id)) counts.alreadyLinked++

  // ---- invoices: by DocNumber; a different amount goes to the owner (the worker would otherwise treat QuickBooks as changed by a person)
  const freeInv = qbInv.rows.filter((q) => !held('Invoice').has(String(q.Id)) && !/^Voided/i.test(String(q.PrivateNote ?? '')))
  for (const inv of crmInvoices) {
    if (invLinks.has(`${inv.table}:${inv.id}`)) { counts.alreadyLinked++; continue }
    if (!inv.docNumber) continue
    const base = { key: `invoice:${inv.table}:${inv.id}`, kind: 'invoice' as const, crmTable: inv.table === 'production_jobs' ? ('production_jobs' as const) : ('job_invoices' as const), crmId: inv.id, label: inv.label }
    const hits = freeInv.filter((q) => String(q.DocNumber ?? '').trim().toLowerCase() === inv.docNumber.trim().toLowerCase())
    if (hits.length === 0) { push({ ...base, state: 'none', reason: 'Not in QuickBooks. It is sent from the start date on.', candidates: [] }); continue }
    const d = (q: QbObject) => `${money(cents(q.TotalAmt))} on ${q.TxnDate ?? '?'}`
    if (hits.length > 1) push({ ...base, state: 'ambiguous', reason: 'More than one QuickBooks invoice has this number.', candidates: hits.map((q) => cand(q, d(q))) })
    else if (cents(hits[0].TotalAmt) !== inv.totalCents) push({ ...base, state: 'ambiguous', reason: `QuickBooks has ${money(cents(hits[0].TotalAmt))} but the CRM says ${money(inv.totalCents)}. Link it (the CRM will not overwrite QuickBooks) or leave it.`, candidates: [cand(hits[0], d(hits[0]))] })
    else push({ ...base, state: 'certain', reason: null, candidates: [cand(hits[0], d(hits[0]))] })
  }

  return {
    items,
    counts,
    qb: { customers: qbPeople.length, jobs: qbJobs.length, invoices: qbInv.rows.length },
    willSend: settings.startDate ? await sweepUnheard(admin, orgId, settings, { dryRun: true }) : { invoices: 0, payments: 0, bills: 0 },
    truncated: qbCust.truncated || qbInv.truncated,
  }
}

/**
 * Writes the links. Customers first (jobs hang off them). Nothing is created in QuickBooks. A QuickBooks record someone else already
 * holds is skipped, never stolen. Records are re-planned here from the CRM and QuickBooks, not taken from the browser.
 */
export async function applyBackfill(
  admin: SupabaseClient,
  orgId: string,
  client: QbClient,
  settings: QbSettings,
  decisions: Decisions,
  userId: string
): Promise<{ linked: number; skipped: number; left: number }> {
  const links = createQbLinks(admin, orgId)
  const plan = await planBackfill(admin, orgId, client, settings, decisions, links)
  if (plan.truncated) throw new Error('QuickBooks has more records than one pass can read; ask support')
  const order = { customer: 0, job: 1, invoice: 2 } as const
  let linked = 0
  let skipped = 0
  for (const it of plan.items.filter((i) => i.state === 'certain').sort((a, b) => order[a.kind] - order[b.kind])) {
    const qbId = it.candidates[0].qbId
    const type = it.kind === 'invoice' ? 'Invoice' : 'Customer'
    const holder = await links.holder(type, qbId)
    if (holder) { skipped++; continue }
    // An invoice whose amount differs is linked with the CRM's amount as "last sent": the worker then sees QuickBooks differ from it and asks a person, never overwrites.
    let sent: number | null | undefined
    let fp: string | null | undefined
    if (it.kind === 'invoice') {
      const r = await client.read<QbObject>('Invoice', qbId)
      if (!r.ok) { skipped++; continue }
      sent = cents(r.value.TotalAmt)
      if (it.reason == null) fp = null
      else sent = null // total differs: no "last sent" figure, so the worker never treats a person's QuickBooks edit as its own
    }
    const put = await links.put({ crmTable: it.crmTable, crmId: it.crmId, qbType: type, qbId, syncToken: null, ...(sent !== undefined ? { sentTotalCents: sent } : {}), ...(fp !== undefined ? { fingerprint: fp } : {}) })
    if (put.ok) linked++
    else skipped++
  }
  await mergeOrgSettings(admin, orgId, { backfill: { doneAt: new Date().toISOString(), doneBy: userId } }, { path: [QUICKBOOKS_SETTINGS_KEY] })
  return { linked, skipped, left: plan.items.filter((i) => i.state === 'ambiguous').length }
}

export { qbQuote }

/** The owner chose not to match anything (after a warning): the first "Start sending" may go ahead. Recorded with who and when. */
export async function skipBackfill(admin: SupabaseClient, orgId: string, userId: string): Promise<void> {
  const { error } = await mergeOrgSettings(admin, orgId, { backfill: { doneAt: new Date().toISOString(), doneBy: userId, skipped: true } }, { path: [QUICKBOOKS_SETTINGS_KEY] })
  if (error) throw new Error('could not record the choice')
}
