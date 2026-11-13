import { NextResponse } from 'next/server'

import { crewIncentivesRouteAuth } from '@/lib/crew-incentives-access'
import { runCrewIncentives, setVisitMark } from '@/lib/crew-incentives-db'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** POST { workOrderId, kind: 'review' | 'callback', on: boolean } — staff with jobs:edit mark a finished visit. */
export async function POST(request: Request) {
  const ctx = await crewIncentivesRouteAuth('mark')
  if (ctx instanceof Response) return ctx
  const b = (await request.json().catch(() => null)) as { workOrderId?: unknown; kind?: unknown; on?: unknown } | null
  if (!b || typeof b.workOrderId !== 'string' || !UUID.test(b.workOrderId) || (b.kind !== 'review' && b.kind !== 'callback') || typeof b.on !== 'boolean') {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const res = await setVisitMark(ctx.admin, ctx.orgId, ctx.userId, b.workOrderId, b.kind, b.on)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  // Propose the line now so the owner sees it on the Bonus approval screen; a failure here is picked up by the morning run.
  if (b.on) await runCrewIncentives(ctx.admin, ctx.orgId).catch((e) => console.error('crew incentives: run after mark failed', e))
  return NextResponse.json({ ok: true })
}
