import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { rotateCrewDayToken } from '@/lib/service-plans-db'

export const dynamic = 'force-dynamic'

/**
 * POST — make a crew's phone link for "today's visits", replacing any older one (which stops working at once). The
 * token is returned this once as a path; the office copies the link from the browser. jobs:edit only.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const res = await rotateCrewDayToken(ctx.admin, ctx.orgId, params.id, ctx.userId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ path: `/crew/day/${res.token}`, expiresInDays: res.expiresInDays })
}
