import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCustomerDisplayName, upsertCustomer } from '@/lib/customers'

export type OrderFormContractRow = {
  id: string
  org_id: string
  opportunity_id: string | null
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  project_address: string
  project_cost: number
  total_squares: number | null
  scope_roof_replacement: boolean | null
  scope_roof_repair: boolean | null
  scope_gutters: boolean | null
  scope_siding: boolean | null
  scope_other: string | null
  deposit_amount: number | null
  exclusions: string | null
  notes: string | null
  customer_signed_at: string | null
  pdf_storage_path: string | null
  created_by: string | null
}

function projectTypeFromContract(c: OrderFormContractRow): 'roofing' | 'siding' | 'mixed' {
  if (c.scope_roof_replacement || c.scope_roof_repair) return 'roofing'
  if (c.scope_siding) return 'siding'
  return 'mixed'
}

function jobTypeFromContract(c: OrderFormContractRow): 'roofing' | 'siding' | 'gutters' | 'mixed' {
  if (c.scope_roof_replacement || c.scope_roof_repair) return 'roofing'
  if (c.scope_siding) return 'siding'
  if (c.scope_gutters) return 'gutters'
  return 'mixed'
}

export async function ensureProductionJobForContract(
  supabase: SupabaseClient,
  params: {
    orgId: string
    projectId: string
    contract: OrderFormContractRow
    customerId: string | null
    actorUserId: string
  }
): Promise<{ production_job_id: string | null; job_number: string | null }> {
  const { orgId, projectId, contract, customerId, actorUserId } = params

  const { data: existingJob } = await supabase
    .from('production_jobs')
    .select('id, job_number')
    .eq('project_id', projectId)
    .maybeSingle()

  if (existingJob?.id) {
    return { production_job_id: existingJob.id, job_number: existingJob.job_number ?? null }
  }

  const jobType = jobTypeFromContract(contract)
  const salespersonId = contract.created_by || actorUserId

  const { data: newJob, error: jobError } = await supabase
    .from('production_jobs')
    .insert({
      org_id: orgId,
      project_id: projectId,
      customer_id: customerId,
      job_type: jobType,
      address_text: contract.project_address || '',
      salesperson_id: salespersonId,
      sale_date: new Date().toISOString().split('T')[0],
      sale_amount: contract.project_cost || null,
      deposit_required_percent:
        contract.deposit_amount && contract.project_cost
          ? Math.round((contract.deposit_amount / contract.project_cost) * 100)
          : null,
      created_by: actorUserId,
      internal_notes: contract.notes || null,
      special_instructions: contract.exclusions || null,
    })
    .select('id, job_number')
    .single()

  if (jobError || !newJob) {
    console.error('[repair-order-form-project] production_jobs insert', jobError)
    return { production_job_id: null, job_number: null }
  }

  await supabase.from('projects').update({ status: 'in_progress' }).eq('id', projectId)

  await supabase.from('activities').insert({
    org_id: orgId,
    project_id: projectId,
    user_id: actorUserId,
    type: 'status_change',
    body: `Production job ${newJob.job_number} created via admin repair (signed contract).`,
  })

  return { production_job_id: newJob.id, job_number: newJob.job_number ?? null }
}

/**
 * Create a project from a completed order_form_contracts row (same shape as contract sign flow).
 */
export async function insertProjectFromSignedContract(
  supabase: SupabaseClient,
  params: {
    contract: OrderFormContractRow
    opportunity: { id: string; lead_id: string | null; customer_id: string | null }
    customerId: string | null
    signedAtIso: string
    actorUserId: string
  }
): Promise<{ project_id: string | null; error: string | null }> {
  const { contract, opportunity, customerId, signedAtIso, actorUserId } = params

  const { data: project, error: projectInsertError } = await supabase
    .from('projects')
    .insert({
      org_id: contract.org_id,
      customer_id: customerId,
      lead_id: opportunity.lead_id,
      opportunity_id: opportunity.id,
      owner_user_id: contract.created_by || actorUserId,
      status: 'open',
      project_type: projectTypeFromContract(contract),
      address_text: contract.project_address,
      roof_squares: contract.total_squares,
      notes: `Contract signed on ${new Date(signedAtIso).toLocaleDateString()} (admin repair)`,
      scope_of_work: [
        contract.scope_roof_replacement && 'Roof Replacement',
        contract.scope_roof_repair && 'Roof Repair',
        contract.scope_gutters && 'Gutters',
        contract.scope_siding && 'Siding',
        contract.scope_other,
      ]
        .filter(Boolean)
        .join(', '),
      contract_pdf_path: contract.pdf_storage_path,
      contract_uploaded_at: signedAtIso,
    })
    .select('id')
    .single()

  if (projectInsertError) {
    return { project_id: null, error: projectInsertError.message }
  }

  return { project_id: project?.id ?? null, error: null }
}

export async function resolveCustomerIdForRepair(
  supabase: SupabaseClient,
  orgId: string,
  contract: OrderFormContractRow,
  opportunity: { customer_id: string | null; lead_id: string | null }
): Promise<string | null> {
  let customerId = opportunity.customer_id ?? null
  if (customerId) return customerId

  let leadForName: {
    homeowner_name: string | null
    phone: string | null
    email: string | null
    address_text: string | null
  } | null = null
  if (opportunity.lead_id) {
    const { data: lr } = await supabase
      .from('leads')
      .select('homeowner_name, phone, email, address_text')
      .eq('id', opportunity.lead_id)
      .maybeSingle()
    leadForName = lr
  }

  const displayName = resolveCustomerDisplayName({
    name: contract.customer_name || leadForName?.homeowner_name,
    address_text: contract.project_address || leadForName?.address_text,
    phone: contract.customer_phone || leadForName?.phone,
  })

  try {
    const { customer_id } = await upsertCustomer(supabase, orgId, {
      name: displayName,
      email: contract.customer_email || leadForName?.email,
      phone: contract.customer_phone || leadForName?.phone,
      address_text: contract.project_address || leadForName?.address_text,
    })
    return customer_id
  } catch (e) {
    console.error('[repair-order-form-project] upsertCustomer', e)
    return null
  }
}
