import { NextResponse } from 'next/server'

import { threadAuth, threadDeal } from '@/lib/threads/api'
import { loadMessage } from '@/lib/threads/post-message'
import { AUDIENCES, canDeleteMessage, canPin, canReadMessage, canReclassify, type Audience } from '@/lib/threads/visibility'

const MAX_CUSTOMER_PINS = 3

/** Pin / unpin / edit / delete (tombstone) / re-classify. Nothing is ever hard-deleted. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const { admin, viewer } = ctx

  const { data: row } = await admin
    .from('activities')
    .select('id, org_id, opportunity_id, customer_id, user_id, body, created_at, audience, restricted_pricing, deleted_at, pinned_at')
    .eq('id', params.id)
    .eq('org_id', viewer.orgId)
    .maybeSingle()
  const r = row as {
    id: string; opportunity_id: string | null; customer_id: string | null; user_id: string | null; body: string | null
    created_at: string; audience: Audience | null; restricted_pricing: boolean | null; deleted_at: string | null
  } | null
  if (!r?.opportunity_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const deal = await threadDeal(ctx, r.opportunity_id)
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const dealRef = { owner_user_id: deal.owner_user_id, setter_user_id: deal.setter_user_id }
  if (!canReadMessage(viewer, dealRef, { audience: r.audience, restricted_pricing: r.restricted_pricing })) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (r.deleted_at) return NextResponse.json({ error: 'Message was removed' }, { status: 409 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const now = new Date().toISOString()

  switch (body.action) {
    case 'pin': {
      if (!canPin(viewer, r)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const scope = body.scope === 'customer' ? 'customer' : 'deal'
      if (scope === 'customer') {
        if (!r.customer_id) return NextResponse.json({ error: 'No customer on this deal' }, { status: 409 })
        const { count } = await admin
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', viewer.orgId).eq('customer_id', r.customer_id).eq('pin_scope', 'customer')
          .not('pinned_at', 'is', null).is('deleted_at', null).neq('id', r.id)
        if ((count ?? 0) >= MAX_CUSTOMER_PINS) return NextResponse.json({ error: `A customer can have ${MAX_CUSTOMER_PINS} alerts` }, { status: 409 })
      }
      const expires = typeof body.expiresAt === 'string' && !Number.isNaN(Date.parse(body.expiresAt)) ? body.expiresAt : null
      await admin.from('activities').update({ pinned_at: now, pinned_by: viewer.userId, pin_scope: scope, pin_expires_at: expires }).eq('id', r.id)
      break
    }
    case 'unpin': {
      if (!canPin(viewer, r)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      await admin.from('activities').update({ pinned_at: null, pinned_by: null, pin_scope: null, pin_expires_at: null }).eq('id', r.id)
      break
    }
    case 'edit': {
      if (r.user_id !== viewer.userId) return NextResponse.json({ error: 'Only the author can edit' }, { status: 403 })
      const text = typeof body.body === 'string' ? body.body.trim() : ''
      if (!text || text.length > 5000) return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
      await admin.from('activities').update({ body: text, edited_at: now }).eq('id', r.id)
      break
    }
    case 'delete': {
      if (!canDeleteMessage(viewer, r)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      await admin.from('activities').update({ deleted_at: now, deleted_by: viewer.userId, pinned_at: null }).eq('id', r.id)
      break
    }
    case 'reclassify': {
      const to = body.audience as Audience
      if (!(AUDIENCES as readonly string[]).includes(to) || !canReclassify(viewer, to)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      await admin.from('activities').update({ audience: to }).eq('id', r.id)
      break
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  return NextResponse.json({ message: await loadMessage(admin, viewer.orgId, r.id) })
}
