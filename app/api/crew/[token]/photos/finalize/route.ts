import { NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/service'
import { CREW_PHOTO_TAGS } from '@/lib/final-photo-tags'
import { CREW_LINK_MAX_PHOTOS, crewLinkPhotoCounts, resolveCrewLink } from '@/lib/crew-link'
import { finalizeJobPhotoUpload } from '@/lib/job-photo-upload'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/crew/[token]/photos/finalize — body: { photoId, photo_tag, mime_type?, file_size? }
 *
 * Records a crew photo against the token's trade. Tags are limited to the
 * walk-around angles + "other"; the photo always lands on the token's own job.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const link = await resolveCrewLink(admin, params.token)
  if (!link.ok) {
    return NextResponse.json(
      { error: link.reason === 'expired' ? 'This photo link has expired — call ARX.' : 'This photo link is no longer active.' },
      { status: link.reason === 'expired' ? 410 : 404 }
    )
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const photoId = typeof body?.photoId === 'string' ? body.photoId : ''
  if (!UUID_RE.test(photoId)) {
    return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
  }
  const photoTag = typeof body?.photo_tag === 'string' ? body.photo_tag : ''
  if (!(CREW_PHOTO_TAGS as readonly string[]).includes(photoTag)) {
    return NextResponse.json({ error: 'Invalid photo type' }, { status: 400 })
  }

  const counts = await crewLinkPhotoCounts(admin, link.ctx)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total >= CREW_LINK_MAX_PHOTOS) {
    return NextResponse.json({ error: 'Photo limit reached for this job — call ARX.' }, { status: 429 })
  }

  const result = await finalizeJobPhotoUpload(admin, {
    orgId: link.ctx.orgId,
    jobId: link.ctx.jobId,
    photoId,
    photoTag,
    mimeType: typeof body?.mime_type === 'string' ? body.mime_type : null,
    fileSize: typeof body?.file_size === 'number' ? body.file_size : null,
    uploadedBy: null,
    workOrderId: link.ctx.workOrderId,
  })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true, photoId: result.photo.id })
}
