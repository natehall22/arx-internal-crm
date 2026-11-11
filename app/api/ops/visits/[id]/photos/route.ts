import { NextResponse } from 'next/server'

import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_VISIT_TYPE } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

/** GET — a visit's photos (newest first); each opens through /api/ops/visits/[id]/photos/[photoId]. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const db = orgDb(ctx.admin, ctx.orgId)
  const { data: visit } = await db.from('work_orders').select('id').eq('id', params.id).eq('work_order_type', SERVICE_VISIT_TYPE).maybeSingle()
  if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data } = await db.from('photos').select('id, filename, created_at').eq('work_order_id', params.id).is('job_id', null).is('deleted_at', null).order('created_at', { ascending: false })
  return NextResponse.json({ photos: data ?? [] })
}
