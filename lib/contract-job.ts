import type { SupabaseClient } from '@supabase/supabase-js'

import { reinstateCancelledJob } from '@/lib/job-cancellation'

/**
 * The ONE place a signed sale agreement becomes a production job. Contract signing (new-project and
 * existing-project cases) and the admin repair route both call it; there is no second insert.
 *
 * Every completed installation / repair agreement gets a job, whatever the trade. 2026-10-26: a gutters-only cash
 * contract (26-10-21, Carann Brown) never got one because the code wrote `job_type: 'gutters'` while the column's CHECK
 * allowed only roofing | siding | windows | mixed; the insert failed, the error was only console.logged, and the project
 * sat open with no job. 'gutters' is now a legal value (migration 202610260010), and a job_type that still fails the
 * CHECK is retried once as 'mixed' rather than dropping the job.
 */

export type ContractForJob = {
  id?: string
  org_id: string
  proposal_id?: string | null
  project_address?: string | null
  project_cost?: number | string | null
  deposit_amount?: number | string | null
  payment_method?: string | null
  notes?: string | null
  exclusions?: string | null
  created_by?: string | null
  scope_roof_replacement?: boolean | null
  scope_roof_repair?: boolean | null
  scope_gutters?: boolean | null
  scope_siding?: boolean | null
}

export type JobType = 'roofing' | 'siding' | 'gutters' | 'mixed'

/** The job type a contract's scope maps to. Roofing wins, then siding, then gutters; anything else is 'mixed'. */
export function jobTypeFromContractScope(c: Pick<ContractForJob, 'scope_roof_replacement' | 'scope_roof_repair' | 'scope_siding' | 'scope_gutters'>): JobType {
  if (c.scope_roof_replacement || c.scope_roof_repair) return 'roofing'
  if (c.scope_siding) return 'siding'
  if (c.scope_gutters) return 'gutters'
  return 'mixed'
}

type Financing = {
  financing_program_id?: string | null
  dealer_fee_percent?: number | null
  dealer_fee_amount?: number | null
}

/** Lender bookkeeping only; the commission base is written by the one writer in lib/job-commission-base.ts. */
async function loadProposalFinancing(supabase: SupabaseClient, contract: ContractForJob): Promise<Financing> {
  if (!contract.proposal_id) return {}
  const { data } = await supabase
    .from('proposals')
    .select('financing_program_id, dealer_fee_percent, dealer_fee_amount')
    .eq('id', contract.proposal_id)
    .maybeSingle()
  if (!data) return {}
  const isFinance = contract.payment_method === 'finance'
  return {
    financing_program_id: isFinance ? data.financing_program_id : null,
    dealer_fee_percent: isFinance ? data.dealer_fee_percent : null,
    dealer_fee_amount: isFinance ? data.dealer_fee_amount : null,
  }
}

export type EnsureJobResult = {
  jobId: string | null
  jobNumber: string | null
  created: boolean
  /** Set when no job exists after the call. Callers log it; the Needs-you "Signed contract with no job" item is the backstop. */
  error: string | null
  financing: Financing
}

export async function ensureJobForSignedContract(
  supabase: SupabaseClient,
  args: {
    contract: ContractForJob
    projectId: string
    customerId: string | null
    salespersonId: string | null
    actorUserId: string | null
    agreementLabel: string
    jobSource?: string | null
    insuranceStage?: string | null
    /** Existing-project signings re-sync customer/salesperson onto a job that already exists. */
    refreshExisting?: boolean
    activityBody?: string
  }
): Promise<EnsureJobResult> {
  const { contract, projectId, customerId, salespersonId, actorUserId } = args
  const orgId = contract.org_id
  const financing = await loadProposalFinancing(supabase, contract)

  const { data: existingJob } = await supabase
    .from('production_jobs')
    .select('id, job_number')
    .eq('project_id', projectId)
    .maybeSingle()

  if (existingJob) {
    await reinstateCancelledJob(supabase, { orgId, jobId: existingJob.id, projectId, userId: actorUserId, saleAmount: contract.project_cost != null ? Number(contract.project_cost) : null })
    if (financing.dealer_fee_amount != null || contract.proposal_id || args.refreshExisting) {
      await supabase
        .from('production_jobs')
        .update({
          ...financing,
          ...(contract.proposal_id ? { accepted_proposal_id: contract.proposal_id } : {}),
          ...(args.refreshExisting && customerId ? { customer_id: customerId } : {}),
          ...(args.refreshExisting && salespersonId ? { salesperson_id: salespersonId } : {}),
        })
        .eq('id', existingJob.id)
        .eq('org_id', orgId)
    }
    return { jobId: existingJob.id, jobNumber: existingJob.job_number ?? null, created: false, error: null, financing }
  }

  const isInsurance = args.jobSource === 'insurance' || contract.payment_method === 'insurance'
  const cost = contract.project_cost != null ? Number(contract.project_cost) : null
  const deposit = contract.deposit_amount != null ? Number(contract.deposit_amount) : null
  const row = (jobType: JobType) => ({
    org_id: orgId,
    project_id: projectId,
    customer_id: customerId,
    job_type: jobType,
    address_text: contract.project_address || '',
    accepted_proposal_id: contract.proposal_id || null,
    salesperson_id: salespersonId,
    sale_date: new Date().toISOString().split('T')[0],
    sale_amount: cost || null,
    deposit_required_percent: deposit && cost ? Math.round((deposit / cost) * 100) : null,
    created_by: contract.created_by ?? actorUserId,
    internal_notes: contract.notes || null,
    special_instructions: contract.exclusions || null,
    job_source: args.jobSource || (isInsurance ? 'insurance' : 'retail'),
    insurance_stage: isInsurance ? args.insuranceStage || 'contingency_signed' : null,
    ...financing,
  })

  const jobType = jobTypeFromContractScope(contract)
  let { data: newJob, error: jobError } = await supabase.from('production_jobs').insert(row(jobType)).select('id, job_number').single()
  if (jobError && jobError.code === '23514' && jobType !== 'mixed' && /job_type_check/.test(jobError.message ?? '')) {
    // Migration 202610290130 not applied yet: a job_type the database does not know must not cost the job (apply the migration before deploying: 'mixed' is booked as a roofing crew).
    console.error('[contract-job] job_type check failed, retrying as mixed:', jobType, jobError.message)
    ;({ data: newJob, error: jobError } = await supabase.from('production_jobs').insert(row('mixed')).select('id, job_number').single())
  }
  if (jobError || !newJob) {
    const message = jobError?.message ?? 'insert returned no row'
    console.error('[contract-job] production job NOT created for project', projectId, message)
    return { jobId: null, jobNumber: null, created: false, error: message, financing }
  }

  await supabase.from('projects').update({ status: 'in_progress' }).eq('id', projectId)
  await supabase.from('activities').insert({
    org_id: orgId,
    project_id: projectId,
    user_id: contract.created_by ?? actorUserId,
    type: 'status_change',
    body: args.activityBody ?? `Production job ${newJob.job_number} auto-created from signed ${args.agreementLabel}.`,
  })
  return { jobId: newJob.id, jobNumber: newJob.job_number ?? null, created: true, error: null, financing }
}
