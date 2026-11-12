/**
 * Which jobs are paid in full — THE answer for every list that must not call a collected job "owed" (the unpaid card,
 * Billing, the morning email, Undo payment). One loader over the one rule (lib/job-collection.ts): payments in hand,
 * invoice tax, time & materials and a super admin's force all counted. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { evaluateJobCollection, JOB_COLLECTION_COLUMNS } from '@/lib/job-collection'
import { collectionInvoiceFields, loadJobInvoiceFacts } from '@/lib/job-invoice-tax'
import { orgDb } from '@/lib/supabase/org-db'

const ID_CHUNK = 200
function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function jobsPaidInFull(admin: SupabaseClient, orgId: string, jobIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (jobIds.length === 0) return out
  const facts = await loadJobInvoiceFacts(admin, jobIds)
  for (const part of chunks(jobIds)) {
    const { data: jobs, error } = await orgDb(admin, orgId).from('production_jobs').select(`id, ${JOB_COLLECTION_COLUMNS}`).in('id', part)
    if (error) throw new Error(`billing: read jobs for the paid rule: ${error.message}`)
    const { data: pays, error: payError } = await admin.from('job_payments').select('job_id, amount_cents, funding_status').in('job_id', part) // org-scope-ok: job ids were just read company-scoped
    if (payError) throw new Error(`billing: read job payments: ${payError.message}`)
    const byJob = new Map<string, Array<{ amount_cents: number; funding_status: string | null }>>()
    for (const p of (pays ?? []) as Array<{ job_id: string; amount_cents: number; funding_status: string | null }>) byJob.set(p.job_id, [...(byJob.get(p.job_id) ?? []), p])
    for (const j of (jobs ?? []) as Array<{ id: string; sale_amount: number | null; allow_close_with_balance: boolean | null; close_balance_by: string | null }>) {
      const c = evaluateJobCollection({ saleAmount: j.sale_amount, ...collectionInvoiceFields(facts.get(j.id)), payments: byJob.get(j.id) ?? [], allowCloseWithBalance: j.allow_close_with_balance, closeBalanceBy: j.close_balance_by })
      if (c.paidInFull) out.add(j.id)
    }
  }
  return out
}
