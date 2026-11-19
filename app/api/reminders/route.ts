import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { orgTodayYmd } from '@/lib/project-tools/org-today'
import { canSeeAllReminders, createReminder, listReminders } from '@/lib/reminders'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type Profile = { id: string; org_id: string; full_name: string | null; role: string; is_super_admin?: boolean | null; active?: boolean | null }

async function signedIn(): Promise<{ profile: Profile } | Response> {
  try {
    const { profile } = await requireAuthApi()
    return { profile: profile as Profile }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

/**
 * GET /api/reminders?customerId=|jobId=|partnerId=  — open reminders on that record (mine, or everyone's for owner / office);
 * `scope=all` (office only) = everyone's open reminders. No filter = mine. Also returns `today` (the company's day) for the chips.
 */
export async function GET(request: Request) {
  const who = await signedIn()
  if (who instanceof Response) return who
  const { profile } = who
  const off = await orgFeatureOffResponse(profile.org_id, 'reminders')
  if (off) return off
  const url = new URL(request.url)
  const admin = createServiceClient()
  const seesAll = canSeeAllReminders(profile)
  const target = { jobId: url.searchParams.get('jobId'), customerId: url.searchParams.get('customerId'), partnerId: url.searchParams.get('partnerId') }
  const onRecord = !!(target.jobId || target.customerId || target.partnerId)
  try {
    const [reminders, today] = await Promise.all([
      listReminders(admin, profile.org_id, { viewerId: profile.id, all: seesAll && (onRecord || url.searchParams.get('scope') === 'all'), target }),
      orgTodayYmd(admin, profile.org_id),
    ])
    return NextResponse.json({ reminders, today, seesAll, meId: profile.id })
  } catch (e) {
    console.error('[reminders] list failed', e)
    return NextResponse.json({ error: 'Could not load reminders' }, { status: 500 })
  }
}

/** POST /api/reminders { assigneeId, dueOn, body, jobId? | customerId? | partnerId? | propertyId? } */
export async function POST(request: Request) {
  const who = await signedIn()
  if (who instanceof Response) return who
  const { profile } = who
  const off = await orgFeatureOffResponse(profile.org_id, 'reminders')
  if (off) return off
  const body = await request.json().catch(() => null)
  const result = await createReminder(createServiceClient(), profile.org_id, { id: profile.id, name: profile.full_name }, body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ reminder: result.reminder }, { status: 201 })
}
