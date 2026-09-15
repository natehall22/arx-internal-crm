import { NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/service'
import { CREW_LINK_MAX_PHOTOS, crewLinkPhotoCounts, resolveCrewLink } from '@/lib/crew-link'
import { registerJobPhotoUpload } from '@/lib/job-photo-upload'

export const runtime = 'nodejs'

/**
 * POST /api/crew/[token]/photos/register — body: { filename }
 *
 * Public (no session): the crew link token authorizes a signed upload into the
 * token's own job folder only. See `lib/crew-link.ts`.
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

  const counts = await crewLinkPhotoCounts(admin, link.ctx)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total >= CREW_LINK_MAX_PHOTOS) {
    return NextResponse.json({ error: 'Photo limit reached for this job — call ARX.' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as { filename?: unknown } | null
  const filename = typeof body?.filename === 'string' ? body.filename : ''
  const result = await registerJobPhotoUpload(admin, { orgId: link.ctx.orgId, jobId: link.ctx.jobId, filename })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
