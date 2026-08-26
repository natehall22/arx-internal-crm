import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { getCustomDateRange, getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { isCalendarDateString, isTimeFrame } from '@/lib/time-frames'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'
import { resolveDashboardMemberScope } from '@/lib/dashboard-member-scope'
import { shouldShowUserOnTeamLeaderboard } from '@/lib/dashboard-team-leaderboard'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type UserProfile = {
  id: string
  org_id: string
  role: string
  team_id: string | null
  region_id: string | null
}

type OrgUser = {
  id: string
  full_name: string | null
  role: string
  show_in_reports: boolean | null
  active: boolean | null
}

type CountRow = {
  owner_id?: string
  canvasser_id?: string
  cnt: number | string
}

type LeaderboardEntry = {
  user_id: string
  full_name: string
  role: string
  primary_metric: number
  doors_knocked: number
  rank: number
  badge_count: number
}

type LeaderboardResponse = {
  setters: LeaderboardEntry[]
  closers: LeaderboardEntry[]
  timeframe: string
  startDate: string
  endDate: string
  asOf: string
}

const CLOSER_ROLES = new Set(['closer', 'sales_rep', 'rep'])
const TIMEZONE = 'America/New_York'

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function countMap(rows: CountRow[], idKey: 'owner_id' | 'canvasser_id') {
  const map = new Map<string, number>()
  for (const row of rows) {
    const userId = row[idKey]
    if (userId) map.set(userId, toNumber(row.cnt))
  }
  return map
}

function rankEntries(
  users: OrgUser[],
  primaryByUserId: Map<string, number>,
  doorsByUserId: Map<string, number>,
  badgeCountByUserId: Map<string, number>,
) {
  return users
    .map((user) => ({
      user_id: user.id,
      full_name: user.full_name || 'Unknown',
      role: user.role,
      primary_metric: primaryByUserId.get(user.id) ?? 0,
      doors_knocked: doorsByUserId.get(user.id) ?? 0,
      badge_count: badgeCountByUserId.get(user.id) ?? 0,
      rank: 0,
    }))
    .sort((a, b) => {
      if (b.primary_metric !== a.primary_metric) return b.primary_metric - a.primary_metric
      if (b.doors_knocked !== a.doors_knocked) return b.doors_knocked - a.doors_knocked
      return a.full_name.localeCompare(b.full_name)
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}

export async function POST(request: NextRequest) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createServiceClient()
    const userProfile: UserProfile = {
      id: authContext.authUser.id,
      org_id: authContext.profile.org_id,
      role: authContext.profile.role,
      team_id: authContext.profile.team_id ?? null,
      region_id: authContext.profile.region_id ?? null,
    }

    // ── Filters (dashboard parity: /api/dashboard/team-stats) ─────────────────
    // Only the date window is caller-controlled. Org and role always come from the
    // DB-verified profile, and the roster is resolved server-side from that profile —
    // there is deliberately no member/team/user parameter a caller could widen scope with.
    const searchParams = request.nextUrl.searchParams
    const rawTimeframe = searchParams.get('timeframe')
    if (rawTimeframe != null && !isTimeFrame(rawTimeframe)) {
      return NextResponse.json({ error: 'Invalid timeframe' }, { status: 400 })
    }
    const timeframe = rawTimeframe ?? 'week'
    const customStartDate = searchParams.get('startDate')
    const customEndDate = searchParams.get('endDate')

    let dateRange
    if (timeframe === 'custom') {
      if (!isCalendarDateString(customStartDate) || !isCalendarDateString(customEndDate)) {
        return NextResponse.json(
          { error: 'A custom timeframe requires startDate and endDate as YYYY-MM-DD' },
          { status: 400 },
        )
      }
      dateRange = getCustomDateRange(customStartDate, customEndDate, TIMEZONE)
    } else {
      dateRange = getDateRangeForTimeFrame(timeframe, TIMEZONE, false)
    }
    const { start, end } = dateRange

    // ── Roster: exactly who this viewer is allowed to see ─────────────────────
    const scope = await resolveDashboardMemberScope(admin, userProfile)

    // Inactive / hidden users stay in the RPC roster so pin-attributed activity still
    // rolls up (and so a rep who has since left still appears for a past timeframe).
    // shouldShowUserOnTeamLeaderboard() decides who is actually rendered.
    let usersQuery = admin
      .from('users')
      .select('id, full_name, role, show_in_reports, active')
      .eq('org_id', userProfile.org_id)
      .order('full_name', { ascending: true })

    if (!scope.orgWide) {
      usersQuery = usersQuery.in('id', scope.memberIds)
    }

    const { data: userRows, error: usersError } = await usersQuery

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const orgUsers = (userRows ?? []) as unknown as OrgUser[]
    const memberIds = orgUsers.map((orgUser) => orgUser.id)
    // Echo the resolved window back so the client can label what it is showing.
    const responseBase: LeaderboardResponse = {
      setters: [],
      closers: [],
      timeframe,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      asOf: new Date().toISOString(),
    }
    if (memberIds.length === 0) {
      return NextResponse.json(responseBase)
    }

    const rpcArgs = {
      p_org_id: userProfile.org_id,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_member_ids: memberIds,
    }

    const [doorRows, inspectionRows, salesRows] = await Promise.all([
      admin.rpc('dashboard_door_leads_by_owner', rpcArgs),
      admin.rpc('dashboard_inspections_set_by_canvasser', rpcArgs),
      admin.rpc('dashboard_install_sales_by_owner', rpcArgs),
    ])

    const rpcError = doorRows.error || inspectionRows.error || salesRows.error
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    const doorsByUserId = countMap((doorRows.data ?? []) as unknown as CountRow[], 'owner_id')
    const inspectionsByUserId = countMap(
      (inspectionRows.data ?? []) as unknown as CountRow[],
      'canvasser_id',
    )
    const salesByUserId = countMap((salesRows.data ?? []) as unknown as CountRow[], 'owner_id')

    const { data: badgeRows, error: badgeCountError } = await admin
      .from('user_badges')
      .select('user_id')
      .eq('org_id', userProfile.org_id)
      .in('user_id', memberIds)

    if (badgeCountError) {
      // Non-fatal: badge counts are bonus display data. Log and continue with zeroes
      // rather than failing the whole leaderboard response.
      console.error('leaderboard: failed to fetch badge counts', badgeCountError)
    }

    const badgeCountByUserId = new Map<string, number>()
    for (const row of badgeRows ?? []) {
      badgeCountByUserId.set(row.user_id, (badgeCountByUserId.get(row.user_id) ?? 0) + 1)
    }

    // Same visibility rule as the dashboard team leaderboard: inactive / hidden users
    // only appear when they have credited activity inside the selected window.
    const visibleUsers = orgUsers.filter((orgUser) =>
      shouldShowUserOnTeamLeaderboard(orgUser, {
        doorsKnocked: doorsByUserId.get(orgUser.id) ?? 0,
        contacts: 0,
        inspectionsSet: inspectionsByUserId.get(orgUser.id) ?? 0,
        inspectionsReceived: 0,
        sits: 0,
        sales: salesByUserId.get(orgUser.id) ?? 0,
      }),
    )

    const setters = rankEntries(
      visibleUsers.filter((orgUser) => isSetterLikeRole(orgUser.role)),
      inspectionsByUserId,
      doorsByUserId,
      badgeCountByUserId,
    )
    const closers = rankEntries(
      visibleUsers.filter((orgUser) => CLOSER_ROLES.has(orgUser.role)),
      salesByUserId,
      doorsByUserId,
      badgeCountByUserId,
    )

    return NextResponse.json({
      ...responseBase,
      setters,
      closers,
    } satisfies LeaderboardResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
