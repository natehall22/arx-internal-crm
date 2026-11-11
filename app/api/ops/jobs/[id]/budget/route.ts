import { NextResponse } from 'next/server'

import { loadBudgetView, setBudgetLine } from '@/lib/project-tools/budget-db'
import { forbidden, projectToolsAuth } from '@/lib/project-tools/route-auth'

export const runtime = 'nodejs'

/** GET /api/ops/jobs/[id]/budget — budget, actual (from the cost ledger) and variance per cost code, plus edit history. Money: needs job financials. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  if (!ctx.canSeeMoney) return forbidden()
  try {
    const { view, codes, history, ready } = await loadBudgetView(ctx.admin, ctx.orgId, params.id)
    return NextResponse.json({ view, codes, history, ready, canEdit: ctx.canEdit })
  } catch (e) {
    console.error('[budget GET]', e)
    return NextResponse.json({ error: 'Could not load the budget' }, { status: 500 })
  }
}

/** PUT { code, amount, reason? } — set one code's budget (history row written with it). */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  if (!ctx.canSeeMoney || !ctx.canEdit) return forbidden()
  const body = (await request.json().catch(() => ({}))) as { code?: unknown; amount?: unknown; reason?: unknown }
  const r = await setBudgetLine(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, jobId: params.id }, body)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, changed: r.changed })
}
