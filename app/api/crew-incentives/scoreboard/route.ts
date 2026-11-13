import { NextResponse } from 'next/server'

import { crewIncentivesRouteAuth } from '@/lib/crew-incentives-access'
import { loadScoreboard } from '@/lib/crew-incentives-db'

export const dynamic = 'force-dynamic'

/** GET — this week's crew bonuses for the crews the signed-in person is on (never another crew's). */
export async function GET() {
  const ctx = await crewIncentivesRouteAuth('member')
  if (ctx instanceof Response) return ctx
  return NextResponse.json({ scoreboard: await loadScoreboard(ctx.admin, ctx.orgId, { userId: ctx.userId }) })
}
