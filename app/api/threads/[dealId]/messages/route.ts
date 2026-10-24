import { guardThreadSchema } from '@/lib/threads/route-guard'
import { NextResponse } from 'next/server'

import { dealRefOf } from '@/lib/threads/get-thread'

import { getTimeline } from '@/lib/threads/get-thread'
import { threadAuth, threadDeal, type ThreadCtx } from '@/lib/threads/api'
import { notifyMessage } from '@/lib/threads/notify'
import { loadMessage, postMessage } from '@/lib/threads/post-message'
import { resolveByReply } from '@/lib/threads/waiting'
import { AUDIENCES, canReadMessage, defaultAudience, writableAudiences, type Audience } from '@/lib/threads/visibility'

async function handleGET(request: Request, { params }: { params: { dealId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const deal = await threadDeal(ctx, params.dealId)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const url = new URL(request.url)
  const audiences = (url.searchParams.get('audience') ?? '')
    .split(',')
    .filter((a): a is Audience => (AUDIENCES as readonly string[]).includes(a))
  const dealRef = dealRefOf(deal)

  // Jump to a message (search result / notification deep link): page so that it is the newest row.
  let before = url.searchParams.get('before')
  const around = url.searchParams.get('around')
  if (around && !before) {
    const target = await loadMessage(ctx.admin, ctx.viewer.orgId, around)
    if (target && canReadMessage(ctx.viewer, dealRef, target)) before = new Date(Date.parse(target.created_at) + 1).toISOString()
  }
  const timeline = await getTimeline(ctx.admin, ctx.viewer, deal, {
    scope: url.searchParams.get('scope') === 'customer' ? 'customer' : 'deal',
    audiences,
    humanOnly: url.searchParams.get('humanOnly') === '1',
    before,
    limit: Number(url.searchParams.get('limit')) || undefined,
  })
  const surfaceParam = url.searchParams.get('surface')
  const surface = surfaceParam === 'sales' || surfaceParam === 'job' || surfaceParam === 'overview' ? surfaceParam : 'other'
  return NextResponse.json({
    ...timeline,
    writable: writableAudiences(ctx.viewer, dealRef),
    defaultAudience: defaultAudience(ctx.viewer, { surface }, dealRef),
    canAllowSetters: !ctx.viewer.pricingBarred,
    canPin: ctx.viewer.ownerLike || ctx.viewer.jobEdit || ctx.viewer.managerLike,
    canPinOwn: ctx.viewer.closerLike,
    viewerId: ctx.viewer.userId,
    isOwner: ctx.viewer.ownerLike,
    seesSalesHistoryChip: ctx.viewer.jobBoard && !ctx.viewer.ownerLike,
  })
}

async function handlePOST(request: Request, { params }: { params: { dealId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const deal = await threadDeal(ctx, params.dealId)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const res = await postMessage(ctx.admin, ctx.profile, deal, {
    body: typeof body.body === 'string' ? body.body : '',
    surface: body.surface === 'sales' || body.surface === 'job' || body.surface === 'overview' ? body.surface : 'other',
    audience: (AUDIENCES as readonly string[]).includes(String(body.audience)) ? (body.audience as Audience) : null,
    replyToId: typeof body.replyToId === 'string' ? body.replyToId : null,
    selectedMentionIds: Array.isArray(body.selectedMentionIds) ? body.selectedMentionIds.filter((x): x is string => typeof x === 'string') : [],
    priority: body.priority === 'urgent' || body.priority === 'needs_reply' ? body.priority : null,
    allowSetters: body.allowSetters === true,
    clientId: typeof body.clientId === 'string' ? body.clientId : null,
    source: 'web',
  }, { viewer: ctx.viewer })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

  // Answering clears that person's open items for the message they replied to.
  if (res.message.reply_to_id) await resolveByReply(ctx.admin, ctx.viewer.userId, [res.message.reply_to_id])

  await notifyMessage(ctx.admin, {
    orgId: ctx.viewer.orgId,
    senderId: ctx.viewer.userId,
    senderName: ctx.profile.full_name || 'ARX Team',
    message: res.message,
    deal: { id: deal.id, customerId: deal.customer_id, leadId: deal.lead_id, label: await dealLabel(ctx.admin, deal.id) },
    recipients: res.recipients,
    blindMentions: res.blindMentions,
  }).catch((e) => console.error('notifyMessage', e))

  return NextResponse.json({ message: res.message, pricingNotice: res.pricingNotice })
}

async function dealLabel(admin: ThreadCtx['admin'], dealId: string) {
  const { data } = await admin.from('opportunities').select('address_text').eq('id', dealId).maybeSingle()
  return (data as { address_text?: string | null } | null)?.address_text || 'Job'
}

export const GET = guardThreadSchema(handleGET)
export const POST = guardThreadSchema(handlePOST)
