import { NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { setSharedWithCustomer } from '@/lib/portal/sharing'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

/** PATCH { id, shared } — staff: show (or stop showing) one document in the customer's portal. */
export async function PATCH(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; shared?: unknown }
  if (typeof b.shared !== 'boolean') return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const r = await setSharedWithCustomer(ctx.admin, ctx.viewer, String(b.id ?? ''), b.shared)
  return r.ok ? NextResponse.json({ shared: r.shared }) : NextResponse.json({ error: r.error }, { status: r.status })
}
