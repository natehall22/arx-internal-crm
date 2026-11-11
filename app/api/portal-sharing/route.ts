import { NextResponse } from 'next/server'

import { crossSiteWrite } from '@/lib/online-payments/access'
import { setJobCrewPhotosShared, setPhotoShared, setSharedWithCustomer } from '@/lib/portal/sharing'
import { threadAuth } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

/**
 * PATCH — staff: show (or stop showing) in the customer's portal:
 *  { id, shared }                 one document
 *  { photoId, shared }            one job photo
 *  { jobId, crewPhotos: boolean } the crew's walk-around photos on one job (one tap per job)
 */
export async function PATCH(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; shared?: unknown; photoId?: unknown; jobId?: unknown; crewPhotos?: unknown }
  const r =
    typeof b.jobId === 'string' && typeof b.crewPhotos === 'boolean'
      ? await setJobCrewPhotosShared(ctx.admin, ctx.viewer, b.jobId, b.crewPhotos)
      : typeof b.shared !== 'boolean'
        ? null
        : typeof b.photoId === 'string'
          ? await setPhotoShared(ctx.admin, ctx.viewer, b.photoId, b.shared)
          : await setSharedWithCustomer(ctx.admin, ctx.viewer, String(b.id ?? ''), b.shared)
  if (!r) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  return r.ok ? NextResponse.json({ shared: r.shared }) : NextResponse.json({ error: r.error }, { status: r.status })
}
