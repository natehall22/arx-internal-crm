/**
 * GET /api/needs-you — the daily data-health list, shaped for the caller by the one rule in lib/data-health.ts:
 *   owner (super admin) → everything; ops (job board) → operational rows only, no dollars; anyone else → 403.
 * The shaping happens here on the server; no client ever receives rows it may not see.
 */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { loadNeedsYouForViewer } from '@/lib/data-health'
import { resolveOpsAccess } from '@/lib/ops-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  try {
    const { canJobBoard } = await resolveOpsAccess(admin, ctx.authUser.id, ctx.profile)
    const { audience, report } = await loadNeedsYouForViewer(admin, ctx.profile.org_id, ctx.profile, canJobBoard)
    if (!report) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ audience, report })
  } catch (e) {
    console.error('GET /api/needs-you', e)
    return NextResponse.json({ error: 'Could not load' }, { status: 500 })
  }
}
