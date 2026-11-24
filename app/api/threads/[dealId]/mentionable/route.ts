import { guardThreadSchema } from '@/lib/threads/route-guard'
import { NextResponse } from 'next/server'

import { dealRefOf } from '@/lib/threads/get-thread'

import { mentionCandidates } from '@/lib/note-mentions'
import { threadAuth, threadDeal } from '@/lib/threads/api'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { AUDIENCES, canReadMessage, type Audience } from '@/lib/threads/visibility'

/** Who the @ picker offers: only people who can READ the chosen audience (no "@setter" on a Production note). Anyone else can still be typed — they just get a content-free ping. */
async function handleGET(request: Request, { params }: { params: { dealId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const deal = await threadDeal(ctx, params.dealId)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sp = new URL(request.url).searchParams
  // The private-note people picker: any active person of the company, offered to owners only (the owner decides who may read the note).
  if (sp.get('pick') === '1') {
    if (!ctx.viewer.ownerLike) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { data: all } = await ctx.admin.from('users').select('id, full_name').eq('org_id', ctx.viewer.orgId).eq('active', true).order('full_name')
    return NextResponse.json({ users: ((all ?? []) as Array<{ id: string; full_name: string | null }>).filter((u) => u.id !== ctx.viewer.userId && u.full_name).map((u) => ({ id: u.id, full_name: u.full_name as string })) })
  }
  const aud = sp.get('audience') ?? 'team'
  // For a private note the readers are owners plus the people picked so far (the composer sends them as `visible`).
  const visible = (sp.get('visible') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x))
  const audience: Audience = (AUDIENCES as readonly string[]).includes(aud) ? (aud as Audience) : 'team'

  const { data } = await ctx.admin
    .from('users')
    .select('id, full_name, email, active, role, custom_role_id, is_super_admin, org_id')
    .eq('org_id', ctx.viewer.orgId)
    .eq('active', true)
  const dealRef = dealRefOf(deal)
  const out: { id: string; full_name: string }[] = []
  for (const u of mentionCandidates(data ?? [])) {
    if (u.id === ctx.viewer.userId) continue
    const v = await resolveThreadViewer(ctx.admin, u as never)
    if (canReadMessage(v, dealRef, { audience, restricted_pricing: false, user_id: ctx.viewer.userId, visible_user_ids: visible })) out.push({ id: u.id, full_name: u.full_name as string })
  }
  return NextResponse.json({ users: out })
}

export const GET = guardThreadSchema(handleGET)
