import { NextResponse } from 'next/server'

import { finalizeVisitPhotoUpload } from '@/lib/job-photo-upload'
import { CREW_VISIT_PHOTO_LIMIT, loadCrewVisit } from '@/lib/service-plans-db'
import { activeCrewDay } from '@/lib/service-plans-access'
import { createServiceClient } from '@/lib/supabase/service'
import { orgDb } from '@/lib/supabase/org-db'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** POST — body { photoId, mime_type?, file_size? }: records an uploaded photo on this visit. Public; the crew link authorizes. */
export async function POST(request: Request, { params }: { params: { token: string; id: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const visit = await loadCrewVisit(admin, crew, params.id)
  if (!visit) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const photoId = typeof body?.photoId === 'string' ? body.photoId : ''
  if (!UUID_RE.test(photoId)) return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
  const { count } = await orgDb(admin, crew.orgId).from('photos').select('id', { count: 'exact', head: true }).eq('work_order_id', visit.id)
  if ((count ?? 0) >= CREW_VISIT_PHOTO_LIMIT) return NextResponse.json({ error: `That’s the most photos for one visit (${CREW_VISIT_PHOTO_LIMIT}).` }, { status: 429 })
  const result = await finalizeVisitPhotoUpload(admin, {
    orgId: crew.orgId,
    visitId: visit.id,
    photoId,
    photoTag: 'visit',
    mimeType: typeof body?.mime_type === 'string' ? body.mime_type : null,
    fileSize: typeof body?.file_size === 'number' ? body.file_size : null,
    uploadedBy: null,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, photoId: result.photo.id })
}
