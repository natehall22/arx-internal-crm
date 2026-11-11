import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Sales tax billed on a job's invoices (sum of non-void `job_invoices.tax_cents`), the `invoiceTaxCents` input of the
 * one paid-in-full rule (lib/job-collection.ts): invoice tax is owed ON TOP of `sale_amount`, so it is added to what
 * must be collected — a taxed invoice paid in full never reads as overpaid, and the contract alone never reads as
 * paid. Jobs with no invoice tax (every company without sales tax rates, i.e. the original company) get 0.
 * Before migration 202611110040 there is no `tax_cents` column: everything is 0.
 *
 * Callers pass job ids they already loaded company-scoped. Dependency-free on purpose (client-reachable modules
 * such as lib/job-payments.ts import it).
 */
export async function loadInvoiceTaxCentsByJob(client: SupabaseClient, jobIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = Array.from(new Set(jobIds.filter(Boolean)))
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    // Filters are applied here, not in SQL, so the query is the simplest shape (select + in) every caller's client supports.
    // org-scope-ok: job ids were loaded company-scoped by every caller; job_invoices.org_id only after migration 202611100040
    const { data, error } = await client.from('job_invoices').select('job_id, status, tax_cents').in('job_id', chunk)
    if (error) {
      const missing = (error.code === '42703' || error.code === 'PGRST204') && String(error.message ?? '').includes('tax_cents')
      if (missing) return new Map()
      throw new Error(`invoice tax: ${error.message}`)
    }
    for (const r of (data ?? []) as Array<{ job_id: string; status: string | null; tax_cents: number | null }>) {
      if (r.status === 'void' || !(Number(r.tax_cents) > 0)) continue
      out.set(r.job_id, (out.get(r.job_id) ?? 0) + (Number(r.tax_cents) || 0))
    }
  }
  return out
}
