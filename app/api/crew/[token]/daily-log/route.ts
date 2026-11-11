import { NextResponse } from 'next/server'

import { ymdInBusinessTz } from '@/lib/calendar-business-tz'
import { crewCallName, resolveCrewLink } from '@/lib/crew-link'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { createDailyLog } from '@/lib/project-tools/daily-logs-db'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

/**
 * POST /api/crew/[token]/daily-log — body: { note, photoIds?, weather? }
 *
 * Public (no session): the crew link authorizes one trade on one job. The log lands on that job (with the trade), weather is
 * filled from the job's location, photos are the ones this crew already uploaded with tag `daily_log`. A crew never emails
 * the customer; the office does that from the job page.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const link = await resolveCrewLink(admin, params.token)
  if (!link.ok) {
    return NextResponse.json({ error: link.reason === 'expired' ? `This link has expired — call ${await crewCallName(admin, link.orgId)}.` : 'This link is no longer active.' }, { status: link.reason === 'expired' ? 410 : 404 })
  }
  if (!(await isOrgFeatureOn(link.ctx.orgId, 'projectTools'))) return NextResponse.json({ error: 'The daily log is not turned on.' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { note?: unknown; photoIds?: unknown; weather?: unknown }
  const { data: job } = await admin.from('production_jobs').select('lat, lng').eq('id', link.ctx.jobId).eq('org_id', link.ctx.orgId).maybeSingle()
  const r = await createDailyLog(admin, {
    orgId: link.ctx.orgId,
    jobId: link.ctx.jobId,
    logDate: ymdInBusinessTz(new Date()),
    note: body.note,
    photoIds: body.photoIds,
    weather: body.weather,
    lat: job?.lat ?? null,
    lng: job?.lng ?? null,
    userId: null,
    authorName: 'Crew',
    source: 'crew',
    workOrderId: link.ctx.workOrderId,
  })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
