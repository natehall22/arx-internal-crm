import { NextResponse } from 'next/server'

import { sendDailyLogSummary } from '@/lib/project-tools/daily-logs-db'
import { forbidden, projectToolsAuth } from '@/lib/project-tools/route-auth'

export const runtime = 'nodejs'

/** POST — email this log to the customer ("Send summary to customer"). Office only: a crew never emails customers. */
export async function POST(request: Request, { params }: { params: { id: string; logId: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  if (!ctx.canEdit) return forbidden()
  const body = (await request.json().catch(() => ({}))) as { again?: unknown }
  const r = await sendDailyLogSummary(ctx.admin, { orgId: ctx.orgId, jobId: params.id, logId: params.logId, senderName: ctx.userName, again: body.again === true, job: ctx.job })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, sentTo: r.sentTo })
}
