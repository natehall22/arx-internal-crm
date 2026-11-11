/**
 * The gate + input rules for typing a cost onto a job, shared by the cost-lines route (the "+ Add a cost" buttons) and the
 * AI connector's add_cost_line — so who may add a cost, and what a cost line may say, has ONE answer. The write itself is
 * `addJobCostLine` (lib/job-cost-ledger.ts). Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { isDealerFeeCostLine, normalizeJobCostType, type JobCostType } from '@/lib/job-cost-ledger'
import { resolveOpsAccess } from '@/lib/ops-access'

type CostProfile = { id: string; org_id: string; role: string; custom_role_id?: string | null }

export type CostJob = { id: string; org_id: string; job_number?: string | null; address_text?: string | null }

/** Job-board access AND money:record (adding a cost is "recording job money"), and the job is this company's. */
export async function authorizeJobCost(
  admin: SupabaseClient,
  profile: CostProfile,
  jobId: string
): Promise<{ ok: true; job: CostJob } | { ok: false; status: 403 | 404; error: string }> {
  const { canJobBoard } = await resolveOpsAccess(admin, profile.id, profile as never)
  if (!canJobBoard || !(await callerCanAccessJobBilling(admin, profile as never))) return { ok: false, status: 403, error: 'Forbidden' }
  const { data: job } = await admin.from('production_jobs').select('id, org_id, job_number, address_text').eq('id', jobId).eq('org_id', profile.org_id).single()
  if (!job) return { ok: false, status: 404, error: 'Job not found' }
  return { ok: true, job: job as CostJob }
}

export type CostInput = { description: string; costType: JobCostType; amount: number; credit: boolean }

export function parseCostInput(body: { description?: unknown; amount?: unknown; cost_type?: unknown; credit?: unknown }): { ok: true; value: CostInput } | { ok: false; error: string } {
  const description = String(body.description || '').trim()
  if (isDealerFeeCostLine({ description })) return { ok: false, error: 'The lender / dealer fee is added automatically from the financing. Use a different description.' }
  const costType = normalizeJobCostType(body.cost_type, 'other')
  const raw = body.amount
  const parsed = typeof raw === 'number' && !Number.isNaN(raw) ? raw : parseFloat(String(raw ?? '0'))
  const amount = Number.isFinite(parsed) ? parsed : 0
  if (!description) return { ok: false, error: 'Description is required' }
  if (amount < 0) return { ok: false, error: 'Amount cannot be negative. For a return or refund, tick "Return / credit".' }
  return { ok: true, value: { description, costType, amount, credit: body.credit === true } }
}
