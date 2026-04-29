/**
 * Who appears on the team performance leaderboard for a given period.
 * Inactive / hidden users still appear if they have any credited activity in the range.
 */

export type TeamLeaderboardActivity = {
  doorsKnocked: number
  contacts: number
  inspectionsSet: number
  inspectionsReceived: number
  sits: number
  sales: number
}

export function hasDashboardTeamActivity(s: TeamLeaderboardActivity): boolean {
  return (
    s.doorsKnocked > 0 ||
    s.contacts > 0 ||
    s.inspectionsSet > 0 ||
    s.inspectionsReceived > 0 ||
    s.sits > 0 ||
    s.sales > 0
  )
}

export function shouldShowUserOnTeamLeaderboard(
  member: {
    show_in_reports?: boolean | null
    /** Primary flag on `users` (see initial schema). */
    active?: boolean | null
    /** Legacy / alternate column in some environments. */
    is_active?: boolean | null
  },
  stats: TeamLeaderboardActivity
): boolean {
  if (hasDashboardTeamActivity(stats)) return true
  if (member.show_in_reports === false) return false
  if (member.active === false) return false
  if (member.is_active === false) return false
  return true
}
