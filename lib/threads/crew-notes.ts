import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Notes the crew link may show. This is the ONLY thread reader on the public /crew page, and it is an
 * explicit allow-list: audience = 'crew' (never team/sales/production), not price-flagged, not removed,
 * for this deal (and this trade's work order or none). Only the text and time leave the server —
 * no author, no ids beyond the row's own, no pricing.
 */
export type CrewNote = { id: string; body: string; created_at: string }

export async function loadCrewNotes(
  admin: SupabaseClient,
  ctx: { orgId: string; jobId: string; workOrderId: string }
): Promise<CrewNote[]> {
  const { data: job } = await admin.from('production_jobs').select('project_id').eq('id', ctx.jobId).eq('org_id', ctx.orgId).maybeSingle()
  const projectId = (job as { project_id: string | null } | null)?.project_id
  if (!projectId) return []
  const { data: project } = await admin.from('projects').select('opportunity_id').eq('id', projectId).eq('org_id', ctx.orgId).maybeSingle()
  const oppId = (project as { opportunity_id: string | null } | null)?.opportunity_id
  if (!oppId) return []
  const { data } = await admin
    .from('activities')
    .select('id, body, created_at, work_order_id, restricted_pricing')
    .eq('org_id', ctx.orgId)
    .eq('opportunity_id', oppId)
    .eq('audience', 'crew')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)
  return ((data ?? []) as Array<CrewNote & { work_order_id: string | null; restricted_pricing: boolean | null }>)
    .filter((r) => r.restricted_pricing !== true && (r.work_order_id == null || r.work_order_id === ctx.workOrderId))
    .map(({ id, body, created_at }) => ({ id, body, created_at }))
    .reverse() // newest 50, shown oldest first
}
