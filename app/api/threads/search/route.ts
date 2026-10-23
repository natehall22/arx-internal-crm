import { NextResponse } from 'next/server'

import { threadAuth } from '@/lib/threads/api'
import { searchMessages } from '@/lib/threads/search'

export async function GET(request: Request) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const q = new URL(request.url).searchParams.get('q') ?? ''
  const hits = await searchMessages(ctx.admin, ctx.viewer.orgId, ctx.viewer.userId, q)
  return NextResponse.json({ hits })
}
