import { NextResponse } from 'next/server'

import { mentionCandidates } from '@/lib/note-mentions'
import { threadAuth, threadDeal } from '@/lib/threads/api'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { AUDIENCES, canReadMessage, type Audience } from '@/lib/threads/visibility'

/** Who the @ picker offers: only people who can READ the chosen audience (no "@setter" on a Production note). Anyone else can still be typed — they just get a content-free ping. */
export async function GET(request: Request, { params }: { params: { dealId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const deal = await threadDeal(ctx, params.dealId)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const aud = new URL(request.url).searchParams.get('audience') ?? 'team'
  const audience: Audience = (AUDIENCES as readonly string[]).includes(aud) ? (aud as Audience) : 'team'

  const { data } = await ctx.admin
    .from('users')
    .select('id, full_name, email, active, role, custom_role_id, is_super_admin, org_id')
    .eq('org_id', ctx.viewer.orgId)
    .eq('active', true)
  const dealRef = { owner_user_id: deal.owner_user_id, setter_user_id: deal.setter_user_id }
  const out: { id: string; full_name: string }[] = []
  for (const u of mentionCandidates(data ?? [])) {
    if (u.id === ctx.viewer.userId) continue
    const v = await resolveThreadViewer(ctx.admin, u as never)
    if (canReadMessage(v, dealRef, { audience, restricted_pricing: false })) out.push({ id: u.id, full_name: u.full_name as string })
  }
  return NextResponse.json({ users: out })
}
