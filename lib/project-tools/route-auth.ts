/**
 * The one door for every project-tools API route (budget, selections, schedule, daily log): signed in, the company has
 * `projectTools` on, the job is this company's, and what the caller may do. Throwing helpers stay out of routes' way.
 */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'
import { orgDb } from '@/lib/supabase/org-db'

export type ProjectToolsCtx = {
  admin: ReturnType<typeof createServiceClient>
  orgId: string
  userId: string
  userName: string
  job: { id: string; project_id: string | null; customer_id: string | null; address_text: string | null; job_number: string | null; sale_amount: number | null; lat: number | null; lng: number | null }
  canEdit: boolean
  canSeeMoney: boolean
}

export type ProjectToolsAuth = { ok: true; ctx: ProjectToolsCtx } | { ok: false; response: NextResponse }

export async function projectToolsAuth(jobId: string): Promise<ProjectToolsAuth> {
  let session
  try {
    session = await requireAuthApi()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const { authUser, profile } = session
  const off = await orgFeatureOffResponse(profile.org_id, 'projectTools')
  if (off) return { ok: false, response: off }
  const admin = createServiceClient()
  const access = await resolveOpsAccess(admin, authUser.id, profile)
  if (!access.canJobBoard || (await resolveSalesDocAccessBarred(admin, authUser.id, profile))) return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const { data: job } = await orgDb(admin, profile.org_id)
    .from('production_jobs')
    .select('id, project_id, customer_id, address_text, job_number, sale_amount, lat, lng, status')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return { ok: false, response: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
  return {
    ok: true,
    ctx: {
      admin,
      orgId: profile.org_id,
      userId: profile.id,
      userName: profile.full_name || '',
      job,
      canEdit: access.canEditJobs,
      canSeeMoney: access.canViewJobFinancials,
    },
  }
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
