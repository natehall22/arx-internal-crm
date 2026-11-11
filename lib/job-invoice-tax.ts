import type { SupabaseClient } from '@supabase/supabase-js'

import { orgTimeZone } from '@/lib/timezone'

/**
 * What a job's invoices add to "paid in full" (lib/job-collection.ts) — the ONE loader, per job:
 *  - `taxCents`: sales tax billed on its non-void invoices (sum of `job_invoices.tax_cents`). Invoice tax is owed ON TOP of
 *    `sale_amount`, so it is added to what must be collected — a taxed invoice paid in full never reads as overpaid, and the
 *    contract alone never reads as paid. Jobs with no invoice tax (the original company) get 0. Before migration 202611110040
 *    there is no `tax_cents` column: 0.
 *  - `timeAndMaterials` + `invoicedTotalCents`: a job billed by the hour (`production_jobs.billing_mode = 'time_materials'`,
 *    migration 202611120030; before it, no job is) owes what its ISSUED invoices total (sent / partly paid / paid — not
 *    drafts, not void), tax included — not the estimate. `pending` = it is not finished being billed: a draft invoice, or
 *    clocked time on a day not yet approved on Hours to bill. A pending job is never paid in full (payroll waits).
 *
 * Callers pass job ids they already loaded company-scoped. Dependency-free on purpose (client-reachable modules such as
 * lib/job-payments.ts import it). Spread `collectionInvoiceFields(facts)` into evaluateJobCollection.
 */
export type JobInvoiceFacts = {
  taxCents: number
  /** Non-void invoices' total_cents (tax included). */
  invoicedTotalCents: number
  /** Non-void invoices' total − tax (what a time & materials job's commission base is). */
  invoicedPreTaxCents: number
  timeAndMaterials: boolean
  /** T&M only: issued invoices (not draft, not void) — what is owed (tax incl.) and the commission base (tax out). */
  issuedTotalCents: number
  issuedPreTaxCents: number
  /** T&M only: a draft invoice or clocked time not yet billed — the job is still being billed. */
  pending: boolean
}

/** THE "invoiced minus tax" rule: each row's total − its tax, summed (rows already filtered by the caller). Pure. */
export function invoicedPreTaxCents(rows: ReadonlyArray<{ total_cents: number | null; tax_cents?: number | null }>): number {
  return rows.reduce((sum, r) => sum + (Number(r.total_cents) || 0) - (Number(r.tax_cents) || 0), 0)
}

export const NO_INVOICE_FACTS: Readonly<JobInvoiceFacts> = Object.freeze({ taxCents: 0, invoicedTotalCents: 0, invoicedPreTaxCents: 0, timeAndMaterials: false, issuedTotalCents: 0, issuedPreTaxCents: 0, pending: false })

const missingColumn = (error: { code?: string; message?: string }, column: string) =>
  (error.code === '42703' || error.code === 'PGRST204') && String(error.message ?? '').includes(column)

export async function loadJobInvoiceFacts(client: SupabaseClient, jobIds: readonly string[]): Promise<Map<string, JobInvoiceFacts>> {
  const out = new Map<string, JobInvoiceFacts>()
  const ids = Array.from(new Set(jobIds.filter(Boolean)))
  const facts = (id: string) => {
    let f = out.get(id)
    if (!f) out.set(id, (f = { ...NO_INVOICE_FACTS }))
    return f
  }
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    // Filters are applied here, not in SQL, so the query is the simplest shape (select + in) every caller's client supports.
    // org-scope-ok: job ids were loaded company-scoped by every caller; job_invoices.org_id only after migration 202611100040
    let res: { data: unknown[] | null; error: { code?: string; message?: string } | null } = await client.from('job_invoices').select('job_id, status, tax_cents, total_cents').in('job_id', chunk)
    let taxReady = true
    if (res.error && missingColumn(res.error, 'tax_cents')) {
      taxReady = false
      // org-scope-ok: same company-scoped job ids; before migration 202611110040 there is no invoice tax
      res = await client.from('job_invoices').select('job_id, status, total_cents').in('job_id', chunk)
    }
    if (res.error) throw new Error(`invoice facts: ${res.error.message}`)
    const drafts = new Set<string>()
    for (const r of (res.data ?? []) as Array<{ job_id: string; status: string | null; tax_cents?: number | null; total_cents: number | null }>) {
      if (r.status === 'void') continue
      const f = facts(r.job_id)
      const row = { total_cents: Number(r.total_cents) || 0, tax_cents: taxReady && Number(r.tax_cents) > 0 ? Number(r.tax_cents) : 0 }
      f.taxCents += row.tax_cents
      f.invoicedTotalCents += row.total_cents
      f.invoicedPreTaxCents += invoicedPreTaxCents([row])
      if (r.status === 'draft') {
        drafts.add(r.job_id)
        continue
      }
      f.issuedTotalCents += row.total_cents
      f.issuedPreTaxCents += invoicedPreTaxCents([row])
    }
    // org-scope-ok: same company-scoped job ids (the caller loaded them for its own company)
    const jobs = await client.from('production_jobs').select('id, billing_mode').in('id', chunk)
    if (jobs.error) {
      if (missingColumn(jobs.error, 'billing_mode')) continue // migration 202611120030 not applied: no job is billed by the hour
      throw new Error(`invoice facts: ${jobs.error.message}`)
    }
    const tm: string[] = []
    for (const j of (jobs.data ?? []) as Array<{ id: string; billing_mode: string | null }>) {
      if (j.billing_mode !== 'time_materials') continue
      tm.push(j.id)
      const f = facts(j.id)
      f.timeAndMaterials = true
      if (drafts.has(j.id)) f.pending = true
    }
    if (tm.length) for (const id of Array.from(await jobsWithUnbilledClockTime(client, tm))) facts(id).pending = true
  }
  return out
}

/**
 * T&M jobs with clocked time on a day that has no approved billing day (Hours to bill, billed_time_days) — still to bill.
 * The day is the company's local day of the time's start (lib/hourly-billing.ts bills a shift on the day it started).
 * Before the time clock / hourly billing migrations: none.
 */
async function jobsWithUnbilledClockTime(client: SupabaseClient, jobIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  // org-scope-ok: T&M job ids from the caller's company-scoped list; time_entries / billed_time_days rows hang off them
  const { data: entries, error } = await client.from('time_entries').select('production_job_id, org_id, started_at, kind, removed_at').in('production_job_id', jobIds)
  if (error || !entries?.length) return out
  // org-scope-ok: same company-scoped job ids
  const { data: approved } = await client.from('billed_time_days').select('production_job_id, work_date, status').in('production_job_id', jobIds)
  const billed = new Set(((approved ?? []) as Array<{ production_job_id: string; work_date: string; status: string }>).filter((b) => b.status === 'approved').map((b) => `${b.production_job_id}|${b.work_date}`))
  const orgIds = Array.from(new Set((entries as Array<{ org_id: string }>).map((e) => e.org_id)))
  const zones = new Map<string, string>()
  // org-scope-ok: the orgs of company-scoped rows (one company)
  const { data: orgs } = await client.from('orgs').select('id, timezone').in('id', orgIds)
  for (const o of (orgs ?? []) as Array<{ id: string; timezone: string | null }>) zones.set(o.id, orgTimeZone(o.timezone))
  for (const e of entries as Array<{ production_job_id: string; org_id: string; started_at: string; kind: string; removed_at: string | null }>) {
    if (e.removed_at || e.kind === 'break') continue
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: zones.get(e.org_id) ?? orgTimeZone(null), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.started_at))
    if (!billed.has(`${e.production_job_id}|${day}`)) out.add(e.production_job_id)
  }
  return out
}

/** The evaluateJobCollection inputs from a job's facts (none loaded = a fixed-price job with no invoice tax). */
export function collectionInvoiceFields(f: JobInvoiceFacts | null | undefined): { invoiceTaxCents: number; timeAndMaterialsInvoicedCents: number | null; timeAndMaterialsPending: boolean } {
  return {
    invoiceTaxCents: f?.taxCents ?? 0,
    timeAndMaterialsInvoicedCents: f?.timeAndMaterials ? f.issuedTotalCents : null,
    timeAndMaterialsPending: f?.timeAndMaterials ? f.pending : false,
  }
}
