import type { CalendarAccessLevel } from '@/lib/permissions'

export type CloserRegionTeamMeta = { team_id?: string | null; region_id?: string | null }

/**
 * Same rules as Team lane view: optional member pin, then team-manager / regional / admin
 * region+team scoping. Unassigned appointments stay visible when drilling by region/team
 * (not when filtering to a single member).
 */
export function filterAppointmentsByCalendarScope<T extends { closer_user_id?: string | null }>(
  appts: T[],
  opts: {
    calendarAccess: CalendarAccessLevel
    viewerRegionId: string
    viewerTeamId: string
    regionId: string
    teamId: string
    memberId: string
    userById: Map<string, CloserRegionTeamMeta>
  }
): T[] {
  const { calendarAccess, viewerRegionId, viewerTeamId, regionId, teamId, memberId, userById } = opts

  const isCalendarAdmin = calendarAccess === 'admin'
  const isCalendarRegional = calendarAccess === 'regional'
  const isCalendarTeamManager = calendarAccess === 'team'

  return appts.filter((a) => {
    if (memberId) {
      if (!a.closer_user_id) return false
      return a.closer_user_id === memberId
    }
    const meta = a.closer_user_id ? userById.get(a.closer_user_id) : undefined
    if (isCalendarTeamManager && viewerTeamId) {
      if (!a.closer_user_id) return true
      return meta?.team_id === viewerTeamId
    }
    if (isCalendarRegional) {
      if (viewerRegionId) {
        if (!a.closer_user_id) return true
        return meta?.region_id === viewerRegionId
      }
      if (teamId) {
        if (!a.closer_user_id) return true
        return meta?.team_id === teamId
      }
    }
    if (isCalendarAdmin) {
      if (regionId) {
        if (!a.closer_user_id) return true
        return meta?.region_id === regionId
      }
      if (teamId) {
        if (!a.closer_user_id) return true
        return meta?.team_id === teamId
      }
    }
    return true
  })
}
