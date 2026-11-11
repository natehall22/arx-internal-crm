import { NextResponse } from 'next/server'

import { registerVisitPhotoUpload } from '@/lib/job-photo-upload'
import { crewVisitUploadRefusal, loadCrewVisit } from '@/lib/service-plans-db'
import { activeCrewDay } from '@/lib/service-plans-access'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

/** POST — body { filename }: a signed upload into this visit's own photo folder. Public; the crew link authorizes. */
export async function POST(request: Request, { params }: { params: { token: string; id: string } }) {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, params.token)
  if (!crew) return NextResponse.json({ error: 'This link is no longer active — ask the office for a new one.' }, { status: 404 })
  const visit = await loadCrewVisit(admin, crew, params.id)
  if (!visit) return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  const refusal = await crewVisitUploadRefusal(admin, crew.orgId, visit.id)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 429 })
  const body = (await request.json().catch(() => null)) as { filename?: unknown } | null
  const result = await registerVisitPhotoUpload(admin, { orgId: crew.orgId, visitId: visit.id, filename: typeof body?.filename === 'string' ? body.filename : '' })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
