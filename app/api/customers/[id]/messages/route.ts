import { NextResponse } from 'next/server'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { loadCustomerMessageState, setCustomerMessages } from '@/lib/customer-messages-db'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** GET — the customer's automatic emails: on / off, why, and the last few sent. Anyone who can open the customer. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!(await isOrgFeatureOn(ctx.viewer.orgId, 'customerMessages'))) return notFound()
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read) return notFound()
  const state = await loadCustomerMessageState(ctx.admin, ctx.viewer.orgId, params.id)
  if (!state) return NextResponse.json({ ready: false })
  return NextResponse.json({ ready: true, state, canEdit: access.edit })
}

/**
 * PATCH { on: boolean, customerAsked?: boolean } — the office's "don't email" switch (anyone who may edit the customer;
 * field roles never). Turning emails back on for a customer who unsubscribed (or whose address bounced) needs
 * `customerAsked: true` — the customer's own say-so.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!(await isOrgFeatureOn(ctx.viewer.orgId, 'customerMessages'))) return notFound()
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read) return notFound()
  if (!access.edit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { on?: unknown; customerAsked?: unknown } | null
  if (typeof body?.on !== 'boolean') return NextResponse.json({ error: 'Say on or off' }, { status: 400 })
  const r = await setCustomerMessages(ctx.admin, ctx.viewer.orgId, params.id, body.on, ctx.viewer.userId, body.customerAsked === true)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  const state = await loadCustomerMessageState(ctx.admin, ctx.viewer.orgId, params.id)
  return NextResponse.json({ ok: true, state })
}
