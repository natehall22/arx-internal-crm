import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { bulkShiftVisits, previewBulkShift } from '@/lib/service-plans-db'
import { parseBulkShift } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/**
 * POST — the rain / hurricane button: `{ from, to?, days, subId? ('all' | crew id | 'none') }` moves every scheduled
 * visit on those days by `days`. Done and skipped visits (and so billed ones) stay put. jobs:edit only.
 * `preview: true` writes nothing and answers what WOULD move; the real move sends `expectKey` (the preview's selectionKey) and is
 * refused with 409 if the exact visits changed since.
 */
export async function POST(request: Request) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const body = await request.json().catch(() => null)
  const shift = parseBulkShift(body)
  if ('error' in shift) return NextResponse.json({ error: shift.error }, { status: 400 })
  if (shift.subId && shift.subId !== 'all') {
    const { data } = await orgDb(ctx.admin, ctx.orgId).from('sub_contractors').select('id').eq('id', shift.subId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Pick one of your crews' }, { status: 400 })
  }
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (b.preview === true) return NextResponse.json({ preview: await previewBulkShift(ctx.admin, ctx.orgId, shift) })
  const expectKey = typeof b.expectKey === 'string' && b.expectKey ? b.expectKey : undefined
  const res = await bulkShiftVisits(ctx.admin, ctx.orgId, shift, { expectKey })
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ moved: res.moved })
}
