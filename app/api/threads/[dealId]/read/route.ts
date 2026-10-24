import { guardThreadSchema } from '@/lib/threads/route-guard'
import { NextResponse } from 'next/server'

import { threadAuth, threadDeal } from '@/lib/threads/api'
import { ensureThread } from '@/lib/threads/post-message'

/** "Seen by" pointer: the viewer has read this deal's thread up to now. */
async function handlePOST(_req: Request, { params }: { params: { dealId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const deal = await threadDeal(ctx, params.dealId)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const thread = await ensureThread(ctx.admin, ctx.viewer.orgId, deal)
  if (thread) {
    await ctx.admin
      .from('thread_members')
      .upsert({ thread_id: thread.id, user_id: ctx.viewer.userId, org_id: ctx.viewer.orgId, reason: 'joined', last_read_at: new Date().toISOString() }, { onConflict: 'thread_id,user_id' })
  }
  return NextResponse.json({ ok: true })
}

export const POST = guardThreadSchema(handlePOST)
