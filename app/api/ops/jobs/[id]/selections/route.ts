import { NextResponse } from 'next/server'

import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { listSelections, saveSelection } from '@/lib/project-tools/selections-db'
import { forbidden, projectToolsAuth } from '@/lib/project-tools/route-auth'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  const { selections, ready } = await listSelections(ctx.admin, ctx.orgId, params.id, ymdInBusinessTz(new Date()))
  return NextResponse.json({ selections, ready, canEdit: ctx.canEdit, repName: ctx.userName })
}

/** POST { id?, item, allowance, options: [{label, price}], due_date? } — add a selection (or edit one the customer has not chosen yet). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  if (!ctx.canEdit) return forbidden()
  const body = (await request.json().catch(() => ({}))) as { id?: string; item?: unknown; allowance?: unknown; options?: unknown; due_date?: unknown }
  const r = await saveSelection(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, jobId: params.id }, body)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ id: r.id })
}
