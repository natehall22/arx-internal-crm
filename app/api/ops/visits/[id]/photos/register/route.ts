import { NextResponse } from 'next/server'

import { registerVisitPhotoUpload } from '@/lib/job-photo-upload'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_VISIT_TYPE } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export const runtime = 'nodejs'

/** POST — body { filename }: start a photo upload on a visit (office / inspector). jobs:edit. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const { data: visit } = await orgDb(ctx.admin, ctx.orgId).from('work_orders').select('id').eq('id', params.id).eq('work_order_type', SERVICE_VISIT_TYPE).maybeSingle()
  if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { filename?: unknown } | null
  const result = await registerVisitPhotoUpload(ctx.admin, { orgId: ctx.orgId, visitId: params.id, filename: typeof body?.filename === 'string' ? body.filename : '' })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
