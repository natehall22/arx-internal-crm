import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isOwnerProfile } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Turn the new job page (Crews · Materials · Money · Notes · Files) on or off for ONE person: users.ui_prefs.jobPageV2.
 * POST { userId?, enabled } - owners only. No userId = yourself. Off for everyone by default.
 */
export async function POST(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isOwnerProfile(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return NextResponse.json({ error: 'JSON only' }, { status: 415 })
  }
  const body = (await request.json().catch(() => null)) as { userId?: unknown; enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled (true/false) is required' }, { status: 400 })
  const targetId = typeof body.userId === 'string' && body.userId ? body.userId : profile.id

  const admin = createServiceClient()
  const { data: target } = await admin.from('users').select('id, ui_prefs').eq('id', targetId).eq('org_id', profile.org_id).maybeSingle()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const prefs = { ...((target.ui_prefs as Record<string, unknown> | null) ?? {}), jobPageV2: body.enabled }
  const { error } = await admin.from('users').update({ ui_prefs: prefs }).eq('id', target.id)
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, userId: target.id, enabled: body.enabled })
}
