import { NextResponse } from 'next/server'

import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { createDailyLog, listDailyLogs } from '@/lib/project-tools/daily-logs-db'
import { projectToolsAuth } from '@/lib/project-tools/route-auth'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  return NextResponse.json(await listDailyLogs(ctx.admin, ctx.orgId, params.id))
}

/**
 * POST { note, photoIds?, weather? } — the one-tap log. Photos were already uploaded through /api/ops/jobs/[id]/photos/*
 * with tag `daily_log`. Weather is filled in from the job's location when not typed. `sendSummary: true` emails it to the customer.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  const body = (await request.json().catch(() => ({}))) as { note?: unknown; photoIds?: unknown; weather?: unknown; sendSummary?: unknown }
  const r = await createDailyLog(ctx.admin, { orgId: ctx.orgId, jobId: params.id, logDate: ymdInBusinessTz(new Date()), note: body.note, photoIds: body.photoIds, weather: body.weather, lat: ctx.job.lat, lng: ctx.job.lng, userId: ctx.userId, authorName: ctx.userName, source: 'staff' })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ log: r.log })
}
