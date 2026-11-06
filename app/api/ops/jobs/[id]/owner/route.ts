import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { loadJobOwnerCandidates, setJobOwner } from '@/lib/job-owner'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Same gate as editing the job (jobs:edit). Field roles never have it (lib/effective-permissions.ts strips it). */
async function editor() {
  let ctx: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    ctx = await requireAuthApi()
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const admin = createServiceClient()
  const { canEditJobs } = await resolveOpsAccess(admin, ctx.authUser.id, ctx.profile)
  if (!canEditJobs) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { admin, profile: ctx.profile }
}

/** GET — who can be picked as this job's owner. */
export async function GET() {
  const r = await editor()
  if (r.error) return r.error
  return NextResponse.json({ candidates: await loadJobOwnerCandidates(r.admin, r.profile.org_id) })
}

/** PUT { userId: string | null } — set or clear the job's owner. */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const r = await editor()
  if (r.error) return r.error
  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null
  if (!body || !('userId' in body) || (body.userId !== null && typeof body.userId !== 'string')) {
    return NextResponse.json({ error: 'userId must be a user id or null' }, { status: 400 })
  }
  const result = await setJobOwner(r.admin, r.profile.org_id, params.id, (body.userId as string | null) || null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ownerUserId: result.ownerUserId })
}
