import { redirect } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canOpenDeal } from '@/lib/threads/api'
import { dealRefsFor } from '@/lib/threads/get-thread'
import { resolveThreadViewer } from '@/lib/threads/viewer'

/**
 * Old record URLs → the Customer File. Server-side lookups (next.config redirects can't hit the DB).
 * Rollout switch: env CUSTOMER_FILE_REDIRECTS = "all" | a comma list of role slugs ("operations,admin") | unset/"off".
 * Off by default, so the old pages keep working until it is turned on; turning it off again is instant.
 * Every redirect is logged (route + role) so we know when an old page is safe to delete.
 * Keep the stubs ≥12 months: calendar invites and texts outlive the page.
 */
export function fileRedirectsEnabledFor(role: string, env = process.env.CUSTOMER_FILE_REDIRECTS): boolean {
  const v = (env ?? '').trim().toLowerCase()
  if (!v || v === 'off' || v === 'false' || v === '0') return false
  if (v === 'all' || v === 'true' || v === '1') return true
  return v.split(',').map((s) => s.trim()).includes(role.toLowerCase())
}

type Target = { customerId: string; dealId: string; tab: 'sales' | 'job' | 'overview' }

/** Only redirect into a file the person can actually open; otherwise the old page stays (no 404 for the closer assigned by appointment). */
async function canOpen(admin: ReturnType<typeof createServiceClient>, profile: Parameters<typeof resolveThreadViewer>[1], dealId: string): Promise<boolean> {
  const viewer = await resolveThreadViewer(admin, profile)
  const refs = await dealRefsFor(admin, profile.org_id, [dealId])
  const ref = refs.get(dealId)
  return !!ref && canOpenDeal(viewer, ref)
}

function go(route: string, role: string, t: Target): never {
  console.info('[customer-file] redirect', JSON.stringify({ route, role }))
  redirect(`/c/${t.customerId}/d/${t.dealId}/${t.tab}`)
}

/** /opportunities/[id] → Sales tab. Inside-sales queue mode (?queue=1 / ?view=) keeps the old page: the conveyor lives there. */
export async function redirectOpportunityToFile(id: string, searchParams?: Record<string, string | string[] | undefined>) {
  if (searchParams && (searchParams.queue || searchParams.view)) return
  const { profile } = await requireAuth()
  if (!fileRedirectsEnabledFor(profile.role)) return
  const admin = createServiceClient()
  const { data } = await admin.from('opportunities').select('id, customer_id').eq('id', id).eq('org_id', profile.org_id).maybeSingle()
  if (data?.customer_id && (await canOpen(admin, profile, data.id))) go('/opportunities/[id]', profile.role, { customerId: data.customer_id, dealId: data.id, tab: 'sales' })
}

/** /leads/[id] → the deal's Sales tab, else the Prospect File. */
export async function redirectLeadToFile(id: string) {
  const { profile } = await requireAuth()
  if (!fileRedirectsEnabledFor(profile.role)) return
  const admin = createServiceClient()
  const { data } = await admin
    .from('opportunities')
    .select('id, customer_id')
    .eq('lead_id', id)
    .eq('org_id', profile.org_id)
    .not('customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data?.customer_id && (await canOpen(admin, profile, data.id))) go('/leads/[id]', profile.role, { customerId: data.customer_id, dealId: data.id, tab: 'sales' })
  // A lead whose deal exists but is not theirs, or that has no deal yet: the Prospect File only for the latter.
  const { count } = await admin.from('opportunities').select('id', { count: 'exact', head: true }).eq('lead_id', id).eq('org_id', profile.org_id)
  if ((count ?? 0) > 0) return
  console.info('[customer-file] redirect', JSON.stringify({ route: '/leads/[id] (prospect)', role: profile.role }))
  redirect(`/c/lead/${id}`)
}

/** /projects/[id] → Job tab when a job exists, else Sales. */
export async function redirectProjectToFile(id: string) {
  const { profile } = await requireAuth()
  if (!fileRedirectsEnabledFor(profile.role)) return
  const admin = createServiceClient()
  const { data: project } = await admin.from('projects').select('id, opportunity_id').eq('id', id).eq('org_id', profile.org_id).maybeSingle()
  if (!project?.opportunity_id) return
  const { data: opp } = await admin.from('opportunities').select('id, customer_id').eq('id', project.opportunity_id).eq('org_id', profile.org_id).maybeSingle()
  if (!opp?.customer_id || !(await canOpen(admin, profile, opp.id))) return
  const { count } = await admin.from('production_jobs').select('id', { count: 'exact', head: true }).eq('project_id', id).eq('org_id', profile.org_id)
  go('/projects/[id]', profile.role, { customerId: opp.customer_id, dealId: opp.id, tab: (count ?? 0) > 0 ? 'job' : 'sales' })
}

/** /ops/jobs/[id] (the page itself; orders, sheets, measure and run-sheet stay) → Job tab. */
export async function redirectJobToFile(id: string) {
  const { profile } = await requireAuth()
  if (!fileRedirectsEnabledFor(profile.role)) return
  const admin = createServiceClient()
  const { data: job } = await admin.from('production_jobs').select('project_id').eq('id', id).eq('org_id', profile.org_id).maybeSingle()
  if (!job?.project_id) return
  const { data: project } = await admin.from('projects').select('opportunity_id').eq('id', job.project_id).eq('org_id', profile.org_id).maybeSingle()
  if (!project?.opportunity_id) return
  const { data: opp } = await admin.from('opportunities').select('id, customer_id').eq('id', project.opportunity_id).eq('org_id', profile.org_id).maybeSingle()
  if (!opp?.customer_id || !(await canOpen(admin, profile, opp.id))) return
  go('/ops/jobs/[id]', profile.role, { customerId: opp.customer_id, dealId: opp.id, tab: 'job' })
}
