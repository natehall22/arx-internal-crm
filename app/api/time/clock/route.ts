import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'
import { parseClockTap } from '@/lib/time-tracking'
import { applyClockTap, loadClockState } from '@/lib/time-tracking-db'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, private' }

async function signedIn() {
  try {
    const { profile } = await requireAuthApi()
    return profile as { id: string; org_id: string }
  } catch {
    return null
  }
}

/** GET — the signed-in person's clock: themselves, plus the crews they lead (job page "Clock in"). */
export async function GET() {
  const me = await signedIn()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const off = await orgFeatureOffResponse(me.org_id, 'timeTracking')
  if (off) return off
  return NextResponse.json(await loadClockState(createServiceClient(), { via: 'signed_in', orgId: me.org_id, userId: me.id }), { headers: noStore })
}

/** POST — one tap (same body as the crew link; `jobId` names the job). */
export async function POST(request: Request) {
  const me = await signedIn()
  if (!me) return NextResponse.json({ error: 'Unauthorized', permanent: true }, { status: 401 })
  const off = await orgFeatureOffResponse(me.org_id, 'timeTracking')
  if (off) return off
  const parsed = parseClockTap(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, permanent: true }, { status: 400 })
  const res = await applyClockTap(createServiceClient(), { via: 'signed_in', orgId: me.org_id, userId: me.id }, parsed.tap)
  if (!res.ok) return NextResponse.json({ error: res.error, permanent: res.permanent ?? false }, { status: res.status })
  return NextResponse.json({ ok: true, done: res.done }, { headers: noStore })
}
