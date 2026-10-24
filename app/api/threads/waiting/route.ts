import { guardThreadSchema } from '@/lib/threads/route-guard'
import { NextResponse } from 'next/server'

import { threadAuth } from '@/lib/threads/api'
import { listWaiting } from '@/lib/threads/waiting'

async function handleGET() {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json({ items: await listWaiting(ctx.admin, ctx.viewer) })
}

export const GET = guardThreadSchema(handleGET)
