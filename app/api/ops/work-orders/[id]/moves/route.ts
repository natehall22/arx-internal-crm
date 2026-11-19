import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'
import { loadMoveHistory } from '@/lib/work-order-moves-db'

export const dynamic = 'force-dynamic'

/** GET /api/ops/work-orders/[id]/moves — the date changes of one work order, newest first (job-board people; no money). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  let ctx: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const profile = ctx.profile as { id: string; org_id: string; role: string; custom_role_id?: string | null }
  const { canJobBoard } = await resolveOpsAccess(admin, ctx.authUser.id, profile)
  if (!canJobBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ moves: await loadMoveHistory(admin, profile.org_id, params.id) })
}
