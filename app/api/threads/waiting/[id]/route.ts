import { NextResponse } from 'next/server'

import { threadAuth } from '@/lib/threads/api'
import { resolveWaiting } from '@/lib/threads/waiting'

/** Done / Snooze 1h on the caller's OWN item (the update is scoped to recipient_user_id). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const body = await request.json().catch(() => ({}))
  const action = body?.action === 'snooze' ? 'snooze' : body?.action === 'done' ? 'done' : null
  if (!action) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const ok = await resolveWaiting(ctx.admin, ctx.viewer.userId, params.id, action)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
