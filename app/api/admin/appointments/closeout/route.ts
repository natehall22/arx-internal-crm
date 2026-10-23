/**
 * Owner-only "Close out old appointments".
 *   GET   → { count, oldest, newest, recentBatches }  (what would be closed; nothing changes)
 *   POST  { confirm: <count shown> } → closes them in one audited batch → { batchId, closed }
 *   POST  { undoBatch } → restores that batch
 * The count the owner saw must match, so a stale screen can't close more than was shown.
 */
import { NextRequest, NextResponse } from 'next/server'

import { closeOutOldAppointments, previewCloseout, undoCloseout } from '@/lib/appointment-closeout'
import { requireAuthApi } from '@/lib/auth'
import { isOwnerProfile } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function owner() {
  try {
    const { profile } = await requireAuthApi()
    if (!isOwnerProfile(profile)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
    return { profile, admin: createServiceClient() } as const
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
}

export async function GET() {
  const a = await owner()
  if ('error' in a) return a.error
  try {
    return NextResponse.json(await previewCloseout(a.admin, a.profile.org_id))
  } catch (e) {
    console.error('closeout preview', e)
    return NextResponse.json({ error: 'Could not load' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const a = await owner()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as { confirm?: unknown; undoBatch?: unknown } | null
  try {
    if (typeof body?.undoBatch === 'string' && /^[0-9a-f-]{36}$/i.test(body.undoBatch)) {
      return NextResponse.json({ ok: true, ...(await undoCloseout(a.admin, { orgId: a.profile.org_id, actorUserId: a.profile.id, batchId: body.undoBatch })) })
    }
    const preview = await previewCloseout(a.admin, a.profile.org_id)
    if (typeof body?.confirm !== 'number' || body.confirm !== preview.count) {
      return NextResponse.json({ error: 'The count changed. Reload and confirm again.', count: preview.count }, { status: 409 })
    }
    if (preview.count === 0) return NextResponse.json({ ok: true, batchId: null, closed: 0 })
    return NextResponse.json({ ok: true, ...(await closeOutOldAppointments(a.admin, { orgId: a.profile.org_id, actorUserId: a.profile.id })) })
  } catch (e) {
    console.error('closeout', e)
    return NextResponse.json({ error: 'Could not close out the appointments' }, { status: 500 })
  }
}
