import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'
import { rollWorkOrder } from '@/lib/work-order-roll'
import { parseRollReason } from '@/lib/work-order-rolls'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ops/work-orders/[id]/roll  { reason?: 'site_not_ready' | 'weather' | 'builder_asked' | 'other' }
 * "Not ready — roll": pushes ONE scheduled service visit or trade work order to its crew's next working day (jobs:edit, like every
 * other schedule change). The move itself goes through the existing writers; see lib/work-order-roll.ts.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let ctx: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const profile = ctx.profile as { id: string; org_id: string; role: string; custom_role_id?: string | null }
  const { canEditJobs } = await resolveOpsAccess(admin, ctx.authUser.id, profile)
  if (!canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  const reason = parseRollReason(body?.reason)
  if (reason && typeof reason === 'object') return NextResponse.json(reason, { status: 400 })
  const res = await rollWorkOrder(admin, profile.org_id, params.id, { reason, by: { userId: ctx.authUser.id, subId: null }, schedulingUserId: ctx.authUser.id })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, from: res.from, to: res.to, rolls: res.rolls })
}
