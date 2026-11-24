import { guardThreadSchema } from '@/lib/threads/route-guard'
import { NextResponse } from 'next/server'

import { UNLIMITED_SCOPE, dealInScope } from '@/lib/category-scope'
import { threadAuth } from '@/lib/threads/api'
import { searchMessages } from '@/lib/threads/search'

async function handleGET(request: Request) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const q = new URL(request.url).searchParams.get('q') ?? ''
  const all = await searchMessages(ctx.admin, ctx.viewer.orgId, ctx.viewer.userId, q)
  // A person limited to some work categories finds only notes on deals inside them.
  const scope = ctx.viewer.categoryScope ?? UNLIMITED_SCOPE
  const hits: typeof all = []
  for (const h of all) if (await dealInScope(ctx.admin, ctx.viewer.orgId, scope, { customer_id: h.customer_id, lead_id: h.lead_id })) hits.push(h)
  return NextResponse.json({ hits })
}

export const GET = guardThreadSchema(handleGET)
