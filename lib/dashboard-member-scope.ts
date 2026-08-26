import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Who a viewer is allowed to see stats for on the sales dashboard and on the
 * Sisu leaderboard.
 *
 * SINGLE SOURCE OF TRUTH — extracted from `app/api/dashboard/team-stats/route.ts`
 * so the Sisu leaderboard cannot drift from the dashboard's scoping. Do not
 * re-implement this per route; extend it here.
 *
 * Rules (unchanged from the dashboard, except where noted):
 *  - admin                            → the whole org
 *  - sales_manager   + team_id        → that team
 *  - regional_manager + region_id     → every team in that region
 *  - anyone else     + team_id        → that team
 *  - no team/region to scope by       → just themselves (fail closed)
 *
 * The viewer is always included in a non-org-wide scope so they can see their
 * own row; a viewer seeing themselves can never be a data leak.
 *
 * FAIL-CLOSED FIX: the dashboard's original inline version fell through to
 * ORG-WIDE for a `regional_manager` with no `region_id`, because the
 * "anyone else" branch excluded regional managers. That silently widened
 * scope. Here that case resolves to self-only. No production user currently
 * hits it (there are no regional_manager rows), so this is a hardening change,
 * not a behavior change for anyone live.
 */

export type MemberScopeProfile = {
  id: string
  org_id: string
  role: string
  team_id?: string | null
  region_id?: string | null
}

export type MemberScope = {
  /** True when the viewer may see every user in the org (admins). */
  orgWide: boolean
  /**
   * Explicit user ids the viewer may see. Empty ONLY when `orgWide` is true —
   * callers must treat a non-org-wide empty list as "nobody", never as "all".
   */
  memberIds: string[]
}

/**
 * Resolve the set of user ids a viewer is allowed to see stats for.
 * Requires a client that can read `users` / `teams` (service role).
 */
export async function resolveDashboardMemberScope(
  supabase: SupabaseClient<any, any, any>,
  profile: MemberScopeProfile
): Promise<MemberScope> {
  if (profile.role === 'admin') {
    return { orgWide: true, memberIds: [] }
  }

  const scoped = new Set<string>([profile.id])

  const addTeamMembers = async (teamIds: string[]) => {
    if (teamIds.length === 0) return
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('org_id', profile.org_id)
      .in('team_id', teamIds)
    for (const row of data ?? []) scoped.add(row.id as string)
  }

  if (profile.role === 'regional_manager') {
    if (profile.region_id) {
      const { data: regionTeams } = await supabase
        .from('teams')
        .select('id')
        .eq('region_id', profile.region_id)
      await addTeamMembers((regionTeams ?? []).map((t) => t.id as string))
    }
    return { orgWide: false, memberIds: Array.from(scoped) }
  }

  if (profile.team_id) {
    await addTeamMembers([profile.team_id])
  }

  return { orgWide: false, memberIds: Array.from(scoped) }
}
