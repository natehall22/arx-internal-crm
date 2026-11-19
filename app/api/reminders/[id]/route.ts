import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { canSeeAllReminders, setReminderDone } from '@/lib/reminders'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** PATCH /api/reminders/<id> { done: boolean } — mark done or reopen (the assignee, who made it, or owner / office). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const off = await orgFeatureOffResponse(profile.org_id, 'reminders')
  if (off) return off
  const body = (await request.json().catch(() => null)) as { done?: unknown } | null
  if (typeof body?.done !== 'boolean') return NextResponse.json({ error: 'Say done or not' }, { status: 400 })
  const result = await setReminderDone(createServiceClient(), profile.org_id, { id: profile.id, seesAll: canSeeAllReminders(profile) }, params.id, body.done)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
