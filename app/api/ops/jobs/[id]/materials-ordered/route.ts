import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { markMaterialsOrdered, unmarkMaterialsOrdered } from '@/lib/job-status-events'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function authorize() {
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()
    const { canEditJobs } = await resolveOpsAccess(admin, authUser.id, profile)
    return { admin, profile, canEditJobs }
  } catch {
    return null
  }
}

/**
 * POST /api/ops/jobs/[id]/materials-ordered — body: { source?: 'one_tap' | 'board' }
 *
 * The one tap that records "materials ordered" (sets the date, moves a sold job
 * to Material Ordering). Replaces the four-button delivery picker nobody used.
 * Downloading the supplier order sheet records the same thing on its own.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await authorize()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { source?: unknown } | null
  const source = body?.source === 'board' ? 'board' : 'one_tap'
  const result = await markMaterialsOrdered(ctx.admin, { orgId: ctx.profile.org_id, jobId: params.id, source })
  if (result.error === 'Job not found') return NextResponse.json({ error: result.error }, { status: 404 })
  if (result.error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 })
  return NextResponse.json({ ok: true, changed: result.changed })
}

/** DELETE — undo a mistaken tap (back to "not ordered"). */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await authorize()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await unmarkMaterialsOrdered(ctx.admin, { orgId: ctx.profile.org_id, jobId: params.id })
  if (result.error === 'Job not found') return NextResponse.json({ error: result.error }, { status: 404 })
  if (result.error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 })
  return NextResponse.json({ ok: true, changed: result.changed })
}
