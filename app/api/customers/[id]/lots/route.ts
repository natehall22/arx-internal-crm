import { NextResponse } from 'next/server'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { addLots, readAddLotsBody } from '@/lib/lots-db'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { resolveOpsAccess } from '@/lib/ops-access'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

/**
 * POST — add a batch of lots (at most LOTS_BATCH) for a builder: { development, rows: [{ lot, address?, city?, state?, zip? }],
 * trades: slug[], createJobs }. Property tools must be on; making jobs needs the same permission as creating a job.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const off = await orgFeatureOffResponse(ctx.viewer.orgId, 'projectTools')
  if (off) return off
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.edit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = readAddLotsBody(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.value.createJobs) {
    const ops = await resolveOpsAccess(ctx.admin, ctx.profile.id, ctx.profile)
    if (!ops.canCreateProductionJob) return NextResponse.json({ error: 'You can add lots, but not make jobs' }, { status: 403 })
  }
  const out = await addLots(ctx.admin, ctx.viewer.orgId, ctx.profile.id, params.id, parsed.value, { accessNotes: access.accessNotes })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out.result)
}
