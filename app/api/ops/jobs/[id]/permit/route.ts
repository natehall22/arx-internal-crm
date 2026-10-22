import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isPermitAction, permitUpdate } from '@/lib/job-status-events'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/ops/jobs/[id]/permit — body: { action: 'not_needed' | 'applied' | 'approved', permit_number? }
 *
 * The permit step on the job page. One tap per real event; `permit_required`
 * and `permit_status` are written together so they can't disagree.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let admin
  let profile
  try {
    const auth = await requireAuthApi()
    profile = auth.profile
    admin = createServiceClient()
    const { canEditJobs } = await resolveOpsAccess(admin, auth.authUser.id, profile)
    if (!canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown; permit_number?: unknown } | null
  if (!isPermitAction(body?.action)) {
    return NextResponse.json({ error: 'action must be not_needed, applied or approved' }, { status: 400 })
  }
  const permitNumber = typeof body?.permit_number === 'string' ? body.permit_number : undefined

  const { data, error } = await admin
    .from('production_jobs')
    .update(permitUpdate(body.action, permitNumber))
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .neq('status', 'cancelled')
    .select('id, permit_required, permit_status, permit_number')
    .maybeSingle()
  if (error) {
    console.error('[job permit PATCH]', params.id, error)
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json({ ok: true, permit: data })
}
