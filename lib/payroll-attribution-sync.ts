import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Keep project/job ownership aligned with closer attribution changes.
 * Payroll and ops still read these downstream fields.
 *
 * Reporting note: dashboard RPCs count appointment/opportunity rows by date
 * and current user FKs (`canvasser_user_id`, `closer_user_id`, `setter_user_id`,
 * `owner_user_id`). Updating those IDs reattributes credit between users; it does
 * not create or delete rows, so org-wide appointment/sit/sale *counts* stay the same.
 */
export async function syncCloserAttributionDownstream(
  supabase: SupabaseClient,
  params: {
    orgId: string
    closerUserId: string | null
    opportunityId?: string | null
    leadId?: string | null
  }
): Promise<void> {
  const { orgId, closerUserId, opportunityId, leadId } = params

  let projectQuery = supabase
    .from('projects')
    .select('id')
    .eq('org_id', orgId)

  if (opportunityId) {
    projectQuery = projectQuery.eq('opportunity_id', opportunityId)
  } else if (leadId) {
    projectQuery = projectQuery.eq('lead_id', leadId)
  } else {
    return
  }

  const { data: projects, error: fetchError } = await projectQuery
  if (fetchError) {
    console.error('[payroll-attribution-sync] fetch projects', fetchError)
    return
  }

  const projectIds = (projects || []).map((project) => project.id).filter(Boolean)
  if (projectIds.length === 0) return

  const { error: projectError } = await supabase
    .from('projects')
    .update({ owner_user_id: closerUserId })
    .eq('org_id', orgId)
    .in('id', projectIds)

  if (projectError) {
    console.error('[payroll-attribution-sync] update projects.owner_user_id', projectError)
  }

  const { error: jobsError } = await supabase
    .from('production_jobs')
    .update({ salesperson_id: closerUserId })
    .eq('org_id', orgId)
    .in('project_id', projectIds)

  if (jobsError) {
    console.error('[payroll-attribution-sync] update production_jobs.salesperson_id', jobsError)
  }
}
