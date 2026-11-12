/**
 * Who may use crew incentives (server only). One answer for every route and page:
 *   - the company's industry profile is lawn_landscape, else nobody (404) — ARX has no such API or page;
 *   - the company's rules (Settings): owners (`isSuperAdmin`), even while the switch is still off (that is where it is turned on);
 *   - marking a visit (review named the crew / callback): the switch on + `jobs:edit` (`canEditJobs`);
 *   - the scoreboard: the switch on + any signed-in person; the data itself is limited to their own crews (lib/crew-incentives-db.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadCrewIncentivesState, type CrewIncentivesState } from '@/lib/crew-incentives-db'

export type CrewIncentivesNeed = 'owner' | 'mark' | 'member'

/** Pure part (tested). */
export function crewIncentivesAllowed(state: Pick<CrewIncentivesState, 'available' | 'active'>, need: CrewIncentivesNeed, who: { owner: boolean; canEditJobs: boolean }): boolean {
  if (!state.available) return false
  if (need === 'owner') return who.owner
  if (!state.active) return false
  return need === 'mark' ? who.canEditJobs : true
}

export async function crewIncentivesRouteAuth(need: CrewIncentivesNeed): Promise<{ admin: SupabaseClient; userId: string; orgId: string; state: CrewIncentivesState } | Response> {
  const { NextResponse } = await import('next/server')
  const { requireAuthApi } = await import('@/lib/auth')
  const { createServiceClient } = await import('@/lib/supabase/service')
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const profile = auth.profile as { id: string; org_id: string; role: string; custom_role_id?: string | null; is_super_admin?: boolean | null }
  const state = await loadCrewIncentivesState(admin, profile.org_id)
  if (!state.available || (need !== 'owner' && !state.active)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { isSuperAdmin } = await import('@/lib/super-admin')
  const owner = isSuperAdmin(profile as never)
  let canEditJobs = false
  if (need === 'mark') {
    const { resolveOpsAccess } = await import('@/lib/ops-access')
    canEditJobs = (await resolveOpsAccess(admin, profile.id, profile)).canEditJobs
  }
  if (!crewIncentivesAllowed(state, need, { owner, canEditJobs })) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { admin, userId: profile.id, orgId: profile.org_id, state }
}
