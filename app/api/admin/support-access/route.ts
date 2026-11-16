import { NextResponse } from 'next/server'

import { requireAuthApi, SupportWriteRefusedError } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { createServiceClient } from '@/lib/supabase/service'
import { endSupportAccess, GRANT_DURATIONS, grantSupportAccess, isGrantDuration, listSupportLog, supportStatus } from '@/lib/support/access'
import { isSuperAdmin } from '@/lib/super-admin'
import type { User } from '@/lib/types/database'

export const dynamic = 'force-dynamic'

async function owner(request: Request): Promise<{ error: NextResponse } | { profile: User }> {
  if (request.method !== 'GET' && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  try {
    const { profile, support } = await requireAuthApi()
    // A support session never manages the company's own support access (requireAuthApi also refuses its writes).
    if (support) return { error: NextResponse.json({ error: 'Not available in a support session' }, { status: 403 }) }
    if (!isSuperAdmin(profile)) return { error: NextResponse.json({ error: 'Only a company owner can manage support access' }, { status: 403 }) }
    return { profile }
  } catch (e) {
    if (e instanceof SupportWriteRefusedError) return { error: NextResponse.json({ error: e.message }, { status: 403 }) }
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

/** GET — the company's support status and its own support log. Owners only. */
export async function GET(request: Request) {
  const o = await owner(request)
  if ('error' in o) return o.error
  const admin = createServiceClient()
  const [status, log] = await Promise.all([supportStatus(admin, o.profile.org_id), listSupportLog(admin, o.profile.org_id, 100)])
  return NextResponse.json({ ...status, durations: Object.entries(GRANT_DURATIONS).map(([key, v]) => ({ key, label: v.label })), log })
}

/** POST { duration: 'day'|'week'|'month'|'year' } grants; { end: true } ends access now. Always the caller's OWN company. */
export async function POST(request: Request) {
  const o = await owner(request)
  if ('error' in o) return o.error
  const body = (await request.json().catch(() => null)) as { duration?: unknown; end?: unknown } | null
  const admin = createServiceClient()
  const status = await supportStatus(admin, o.profile.org_id)
  if (status.always) return NextResponse.json({ error: 'Support access is always on for this company' }, { status: 409 })
  try {
    if (body?.end === true) {
      await endSupportAccess(admin, o.profile.org_id, o.profile.id)
      return NextResponse.json({ ok: true })
    }
    if (!isGrantDuration(body?.duration)) return NextResponse.json({ error: 'Choose 1 day, 1 week, 1 month or 1 year' }, { status: 400 })
    const { expiresAt } = await grantSupportAccess(admin, o.profile.org_id, o.profile.id, body.duration)
    return NextResponse.json({ ok: true, expiresAt })
  } catch (e) {
    console.error('[support-access] save failed', e)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
