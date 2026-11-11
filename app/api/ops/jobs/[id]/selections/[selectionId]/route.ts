import { NextResponse } from 'next/server'

import { cancelSelection, chooseSelection, loadJobContact, sendSelection } from '@/lib/project-tools/selections-db'
import { forbidden, projectToolsAuth } from '@/lib/project-tools/route-auth'

export const runtime = 'nodejs'

/**
 * POST { action: 'send', repSignature, email? } — get the customer link (and email it);
 *      { action: 'choose', optionId, repSignature } — the office picks for the customer in person (same rules as the link);
 *      { action: 'cancel' }.
 * `repSignature` = a PNG data URL of the sender's name (drawn on a canvas by the phone), used only if a change order results.
 */
export async function POST(request: Request, { params }: { params: { id: string; selectionId: string } }) {
  const auth = await projectToolsAuth(params.id)
  if (!auth.ok) return auth.response
  const { ctx } = auth
  if (!ctx.canEdit) return forbidden()
  const body = (await request.json().catch(() => ({}))) as { action?: string; repSignature?: unknown; email?: unknown; optionId?: unknown }
  if (body.action === 'cancel') {
    const r = await cancelSelection(ctx.admin, { orgId: ctx.orgId, jobId: params.id }, params.selectionId)
    return 'error' in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json({ ok: true })
  }
  if (body.action === 'send') {
    const contact = await loadJobContact(ctx.admin, ctx.orgId, ctx.job)
    const r = await sendSelection(ctx.admin, { orgId: ctx.orgId, userId: ctx.userId, userName: ctx.userName, jobId: params.id, contact }, params.selectionId, { repSignature: body.repSignature, email: body.email === true })
    return 'error' in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json({ ok: true, link: r.link, emailed: r.emailed })
  }
  if (body.action === 'choose') {
    // The selection must be this job's.
    const probe = await ctx.admin.from('job_selections').select('id').eq('id', params.selectionId).eq('job_id', params.id).eq('org_id', ctx.orgId).maybeSingle()
    if (!probe.data) return NextResponse.json({ error: 'Selection not found' }, { status: 404 })
    const r = await chooseSelection(ctx.admin, { orgId: ctx.orgId, selectionId: params.selectionId, optionId: String(body.optionId ?? ''), byName: ctx.userName || 'Office', source: 'staff', staffUserId: ctx.userId, staffName: ctx.userName, staffSignature: body.repSignature })
    return 'error' in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json({ ok: true, state: r.state, difference: r.difference, signingUrl: r.signingUrl })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
