import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { loadJobHistory } from '@/lib/job-changes'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'
import { isUuidLike } from '@/lib/time-tracking'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ops/jobs/[id]/history?page=0 — who changed what on this job, and when (newest first, 50 a page).
 * Anyone who can open the job board (field roles never can). Money fields show only to a viewer who may see job money.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  let ctx: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = ctx
  const admin = createServiceClient()
  const access = await resolveOpsAccess(admin, authUser.id, profile)
  if (!access.canJobBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: job } = await admin.from('production_jobs').select('id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const page = Number(new URL(request.url).searchParams.get('page') ?? 0)
  const { entries, hasMore, startsAt, page: lastPage } = await loadJobHistory(admin, profile.org_id, params.id, { canSeeMoney: access.canViewJobFinancials, page: Number.isFinite(page) ? page : 0 })
  return NextResponse.json({ entries, hasMore, startsAt, page: lastPage })
}
