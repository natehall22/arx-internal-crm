import { NextResponse } from 'next/server'

import { applyTemplate, editStages, loadStages, type StageAction } from '@/lib/project-tools/stages-db'
import { forbidden, projectToolsAuth } from '@/lib/project-tools/route-auth'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  const r = await loadStages(ctx.admin, ctx.orgId, params.id)
  return NextResponse.json({ ...r, canEdit: ctx.canEdit })
}

/** POST { templateId, start, replace? } — build the schedule from a template (first stage on `start`, a workday). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  if (!ctx.canEdit) return forbidden()
  const body = (await request.json().catch(() => ({}))) as { templateId?: unknown; start?: unknown; replace?: unknown }
  const r = await applyTemplate(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, jobId: params.id }, body)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, count: r.count })
}

/** PATCH { action: move | duration | done | rename | add | remove | depends, ... } — change the plan; dependents shift with a move. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  if (!ctx.canEdit) return forbidden()
  const body = (await request.json().catch(() => null)) as StageAction | null
  if (!body || typeof body !== 'object' || typeof (body as { action?: unknown }).action !== 'string') return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  const r = await editStages(ctx.admin, { orgId: ctx.orgId, jobId: params.id }, body)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
