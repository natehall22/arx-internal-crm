import { NextResponse } from 'next/server'

import { finalizeVisitPhotoUpload } from '@/lib/job-photo-upload'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { SERVICE_VISIT_TYPE } from '@/lib/service-plans'
import { orgDb } from '@/lib/supabase/org-db'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** POST — body { photoId, mime_type?, file_size? }: record an uploaded visit photo. jobs:edit. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await servicePlanRouteAuth('edit')
  if (ctx instanceof Response) return ctx
  const { data: visit } = await orgDb(ctx.admin, ctx.orgId).from('work_orders').select('id').eq('id', params.id).eq('work_order_type', SERVICE_VISIT_TYPE).maybeSingle()
  if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const photoId = typeof body?.photoId === 'string' ? body.photoId : ''
  if (!UUID_RE.test(photoId)) return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
  const result = await finalizeVisitPhotoUpload(ctx.admin, {
    orgId: ctx.orgId,
    visitId: params.id,
    photoId,
    photoTag: 'visit',
    mimeType: typeof body?.mime_type === 'string' ? body.mime_type : null,
    fileSize: typeof body?.file_size === 'number' ? body.file_size : null,
    uploadedBy: ctx.userId,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, photoId: result.photo.id })
}
