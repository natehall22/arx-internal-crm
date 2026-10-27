/**
 * Create the production job a signed sale agreement should have, through the SAME code path as contract signing
 * (lib/contract-job.ts). Dry run unless --apply.
 *
 *   npx tsx --env-file=.env.local scripts/fix-contract-job.ts <contract-id>           # prints what it would do
 *   npx tsx --env-file=.env.local scripts/fix-contract-job.ts <contract-id> --apply
 *
 * Undo (printed after an apply): delete the job it created and put the project back to 'open'.
 */
import { createClient } from '@supabase/supabase-js'

import { ensureJobForSignedContract } from '@/lib/contract-job'
import { syncJobSaleAndCommissionBase } from '@/lib/job-commission-base'

async function main() {
  const contractId = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!contractId) throw new Error('usage: fix-contract-job.ts <contract-id> [--apply]')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: contract } = await admin.from('order_form_contracts').select('*').eq('id', contractId).maybeSingle()
  if (!contract) throw new Error('contract not found')
  if (contract.status !== 'completed') throw new Error(`contract is ${contract.status}, not completed`)

  const { data: project } = await admin
    .from('projects').select('id, customer_id, owner_user_id, status')
    .eq('org_id', contract.org_id).eq('opportunity_id', contract.opportunity_id).maybeSingle()
  if (!project) throw new Error('no project for this contract; run the admin repair-contract-project route instead')
  const { data: existing } = await admin.from('production_jobs').select('id, job_number').eq('project_id', project.id).maybeSingle()
  if (existing) { console.log(`job ${existing.job_number} already exists (${existing.id}); nothing to do`); return }

  const { data: opp } = await admin.from('opportunities').select('job_source, insurance_stage').eq('id', contract.opportunity_id).maybeSingle()
  console.log({ contract: contract.id, customer: contract.customer_name, project: project.id, projectCustomer: project.customer_id, projectStatus: project.status, scope_gutters: contract.scope_gutters })
  if (!apply) { console.log('dry run: no job created. Re-run with --apply (after the customer fix has been COMMITted).'); return }

  const result = await ensureJobForSignedContract(admin, {
    contract, projectId: project.id, customerId: project.customer_id, salespersonId: project.owner_user_id || contract.created_by,
    actorUserId: contract.created_by ?? null, agreementLabel: 'Installation Agreement',
    jobSource: opp?.job_source ?? null, insuranceStage: opp?.insurance_stage ?? null, refreshExisting: true,
    activityBody: 'Production job created by data fix (the original signing could not create it: job_type check).',
  })
  if (!result.jobId) throw new Error(`job not created: ${result.error}`)
  await syncJobSaleAndCommissionBase(admin, { orgId: contract.org_id, jobId: result.jobId })
  console.log(`created job ${result.jobNumber} (${result.jobId})`)
  console.log(`UNDO: DELETE FROM production_jobs WHERE id = '${result.jobId}'; UPDATE projects SET status = '${project.status}' WHERE id = '${project.id}';`)
}

main().catch((e) => { console.error(e); process.exit(1) })
