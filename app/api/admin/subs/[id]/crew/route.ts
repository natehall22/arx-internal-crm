import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'
import { isUuidLike } from '@/lib/time-tracking'
import { loadCrewRoster, parseCrewSetup, saveCrewSetup } from '@/lib/time-tracking-db'

export const dynamic = 'force-dynamic'

// Same people who edit subs today (app/api/admin/subs/route.ts).
const CREW_ADMIN_ROLES = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']

async function gate() {
  try {
    const { profile } = await requireAuthApi()
    if (!CREW_ADMIN_ROLES.includes(profile.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
    const off = await orgFeatureOffResponse(profile.org_id, 'timeTracking')
    if (off) return { error: off } as const
    return { profile: profile as { id: string; org_id: string }, admin: createServiceClient() } as const
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
}

/** GET — does this crew clock in, who is on it, and the active people who could be. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await gate()
  if ('error' in g) return g.error
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
  const roster = await loadCrewRoster(g.admin, g.profile.org_id, params.id)
  if (!roster) return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
  const { data } = await orgDb(g.admin, g.profile.org_id).from('users').select('id, full_name').eq('active', true).order('full_name').limit(1000)
  const people = ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => ({ userId: u.id, name: u.full_name || 'Unnamed' }))
  return NextResponse.json({ roster, people })
}

/** PUT { tracksTime, members: [{ userId, isLead }] } — set who is on the crew and whether it clocks in. */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const g = await gate()
  if ('error' in g) return g.error
  if (!isUuidLike(params.id)) return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
  const parsed = parseCrewSetup(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const res = await saveCrewSetup(g.admin, g.profile.org_id, params.id, g.profile.id, parsed.setup)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, roster: await loadCrewRoster(g.admin, g.profile.org_id, params.id) })
}
