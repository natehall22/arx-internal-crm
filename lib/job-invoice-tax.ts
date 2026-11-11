import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * What a job's invoices add to "paid in full" (lib/job-collection.ts) — the ONE loader, per job:
 *  - `taxCents`: sales tax billed on its non-void invoices (sum of `job_invoices.tax_cents`). Invoice tax is owed ON TOP of
 *    `sale_amount`, so it is added to what must be collected — a taxed invoice paid in full never reads as overpaid, and the
 *    contract alone never reads as paid. Jobs with no invoice tax (the original company) get 0. Before migration 202611110040
 *    there is no `tax_cents` column: 0.
 *  - `timeAndMaterials` + `invoicedTotalCents`: a job billed by the hour (`production_jobs.billing_mode = 'time_materials'`,
 *    migration 202611120030; before it, no job is) owes what its non-void invoices total, tax included — not the estimate.
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
}

export const NO_INVOICE_FACTS: Readonly<JobInvoiceFacts> = Object.freeze({ taxCents: 0, invoicedTotalCents: 0, invoicedPreTaxCents: 0, timeAndMaterials: false })

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
    for (const r of (res.data ?? []) as Array<{ job_id: string; status: string | null; tax_cents?: number | null; total_cents: number | null }>) {
      if (r.status === 'void') continue
      const f = facts(r.job_id)
      const tax = taxReady && Number(r.tax_cents) > 0 ? Number(r.tax_cents) : 0
      const total = Number(r.total_cents) || 0
      f.taxCents += tax
      f.invoicedTotalCents += total
      f.invoicedPreTaxCents += total - tax
    }
    // org-scope-ok: same company-scoped job ids (the caller loaded them for its own company)
    const jobs = await client.from('production_jobs').select('id, billing_mode').in('id', chunk)
    if (jobs.error) {
      if (missingColumn(jobs.error, 'billing_mode')) continue // migration 202611120030 not applied: no job is billed by the hour
      throw new Error(`invoice facts: ${jobs.error.message}`)
    }
    for (const j of (jobs.data ?? []) as Array<{ id: string; billing_mode: string | null }>) if (j.billing_mode === 'time_materials') facts(j.id).timeAndMaterials = true
  }
  return out
}

/** The two evaluateJobCollection inputs from a job's facts (none loaded = a fixed-price job with no invoice tax). */
export function collectionInvoiceFields(f: JobInvoiceFacts | null | undefined): { invoiceTaxCents: number; timeAndMaterialsInvoicedCents: number | null } {
  return { invoiceTaxCents: f?.taxCents ?? 0, timeAndMaterialsInvoicedCents: f?.timeAndMaterials ? f.invoicedTotalCents : null }
}
