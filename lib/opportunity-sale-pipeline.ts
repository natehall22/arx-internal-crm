import type { SupabaseClient } from '@supabase/supabase-js'
import { importProjectReviewNoteToJob } from '@/lib/project-review'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Business rule: a `customers` row exists only after a **signed contract**.
 * Inspection "sale" / won opportunity is still lead + opportunity until then.
 */

/** Align with inspection-outcomes id normalization. */
export function normalizeOutcomeId(outcome: string | null | undefined): string {
  return String(outcome || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
}

/**
 * True when this outcome is the "Sale" path (won → project + production job; no customer row yet).
 * Supports org-custom outcome rows that keep label "Sale" with a non-canonical id.
 */
export function isSaleOutcome(
  outcome: string,
  outcomeConfig?: { id?: string; label?: string } | null
): boolean {
  if (normalizeOutcomeId(outcome) === 'sale') return true
  if (outcomeConfig && normalizeOutcomeId(String(outcomeConfig.id || '')) === 'sale') return true
  if (outcomeConfig?.label?.trim().toLowerCase() === 'sale') return true
  return false
}

function mapProjectTypeToJobType(
  projectType: string | null | undefined
): 'roofing' | 'siding' | 'windows' | 'mixed' {
  const t = String(projectType || 'roofing').toLowerCase()
  if (t === 'roofing') return 'roofing'
  if (t === 'siding') return 'siding'
  if (t === 'windows') return 'windows'
  return 'mixed'
}

export type SalePipelineResult = {
  /** Only set if already linked (e.g. after a signed contract); never created here. */
  customer_id: string | null
  project_id: string | null
  production_job_id: string | null
}

/**
 * After an inspection is marked Sale (opportunity status won), ensure:
 * project(opportunity_id) + production_jobs — without creating a `customers` row.
 * Customer records are created when a contract is signed (`/api/contracts/sign`).
 * Idempotent: skips steps when rows already exist.
 */
export async function materializeSaleFromInspectionOutcome(
  supabase: SupabaseClient,
  orgId: string,
  actingUserId: string,
  options: {
    outcome: string
    outcomeConfig?: { id?: string; label?: string } | null
    opportunityId: string | null
    leadId: string | null
    lead: {
      id: string
      homeowner_name?: string | null
      phone?: string | null
      email?: string | null
      address_text?: string | null
      customer_id?: string | null
    } | null
  }
): Promise<SalePipelineResult> {
  const empty: SalePipelineResult = { customer_id: null, project_id: null, production_job_id: null }

  if (!isSaleOutcome(options.outcome, options.outcomeConfig)) return empty
  if (!options.opportunityId || !options.leadId || !options.lead) return empty

  const { data: opp, error: oppErr } = await supabase
    .from('opportunities')
    .select(
      'id, owner_user_id, project_type, address_text, lat, lng, roof_squares, customer_id, status, job_source, insurance_stage'
    )
    .eq('id', options.opportunityId)
    .eq('org_id', orgId)
    .single()

  if (oppErr || !opp) {
    console.error('materializeSaleFromInspectionOutcome: opportunity load', oppErr)
    return empty
  }

  if (opp.status !== 'won') return empty

  /** Carry through only if a contract already created a customer; do not create or assign here. */
  const customerId = opp.customer_id || options.lead.customer_id || null

  const { data: existingProject } = await supabase
    .from('projects')
    .select('id')
    .eq('org_id', orgId)
    .eq('opportunity_id', opp.id)
    .maybeSingle()

  let projectId: string | null = existingProject?.id ?? null

  if (!projectId) {
    const address =
      (options.lead.address_text || opp.address_text || '').trim() || null
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({
        org_id: orgId,
        opportunity_id: opp.id,
        lead_id: options.leadId,
        customer_id: customerId,
        owner_user_id: opp.owner_user_id || actingUserId,
        status: 'in_progress',
        project_type: (opp.project_type as 'roofing' | 'siding' | 'mixed') || 'roofing',
        address_text: address,
        lat: opp.lat,
        lng: opp.lng,
        roof_squares: opp.roof_squares,
        notes: 'Project created from inspection sale (won opportunity).',
      })
      .select('id')
      .single()

    if (projErr) {
      console.error('materializeSaleFromInspectionOutcome: project insert', projErr)
      return { customer_id: customerId, project_id: null, production_job_id: null }
    }
    projectId = project?.id ?? null
  }

  if (!projectId) {
    return { customer_id: customerId, project_id: null, production_job_id: null }
  }

  const { data: existingJob } = await supabase
    .from('production_jobs')
    .select('id')
    .eq('project_id', projectId)
    .maybeSingle()

  if (existingJob?.id) {
    return {
      customer_id: customerId,
      project_id: projectId,
      production_job_id: existingJob.id,
    }
  }

  const jobType = mapProjectTypeToJobType(opp.project_type)
  const addr =
    (options.lead.address_text || opp.address_text || '').trim() || 'Address pending'

  const { data: job, error: jobErr } = await supabase
    .from('production_jobs')
    .insert({
      org_id: orgId,
      project_id: projectId,
      customer_id: customerId,
      job_type: jobType,
      address_text: addr,
      lat: opp.lat,
      lng: opp.lng,
      salesperson_id: opp.owner_user_id || actingUserId,
      sale_date: new Date().toISOString().split('T')[0],
      created_by: actingUserId,
      internal_notes: 'Auto-created from inspection sale outcome.',
      job_source: opp.job_source || 'retail',
      insurance_stage: opp.job_source === 'insurance' ? (opp.insurance_stage || 'contingency_signed') : null,
    })
    .select('id')
    .single()

  if (jobErr) {
    console.error('materializeSaleFromInspectionOutcome: production_jobs insert', jobErr)
    return { customer_id: customerId, project_id: projectId, production_job_id: null }
  }

  const importResult = await importProjectReviewNoteToJob(createServiceClient(), {
    jobId: job.id,
    projectId,
    actorUserId: actingUserId,
  })
  if (!importResult.ok) {
    console.warn('materializeSaleFromInspectionOutcome: project review → job note', importResult.error)
  }

  await supabase.from('projects').update({ status: 'in_progress' }).eq('id', projectId)

  await supabase.from('activities').insert({
    org_id: orgId,
    project_id: projectId,
    opportunity_id: opp.id,
    lead_id: options.leadId,
    user_id: actingUserId,
    type: 'status_change',
    body: 'Project and production job linked from inspection sale (customer record only after signed contract).',
  })

  return {
    customer_id: customerId,
    project_id: projectId,
    production_job_id: job?.id ?? null,
  }
}
