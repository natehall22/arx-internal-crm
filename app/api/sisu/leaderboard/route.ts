import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getDateRangeForTimeFrame } from '@/lib/date-ranges'
import { isSetterLikeRole } from '@/lib/dashboard-setter-role'

export const dynamic = 'force-dynamic'

type LeaderboardRequestBody = {
  orgId?: unknown
  role?: unknown
}

type UserProfile = {
  id: string
  org_id: string
  role: string
}

type OrgUser = {
  id: string
  full_name: string | null
  role: string
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
}

type LeaderboardResponse = {
  setters: LeaderboardEntry[]
  closers: LeaderboardEntry[]
}

const CLOSER_ROLES = new Set(['closer', 'sales_rep', 'rep'])
const TIMEZONE = 'America/New_York'

function getAdminClient() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : null
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
) {
  return users
    .map((user) => ({
      user_id: user.id,
      full_name: user.full_name || 'Unknown',
      role: user.role,
      primary_metric: primaryByUserId.get(user.id) ?? 0,
      doors_knocked: doorsByUserId.get(user.id) ?? 0,
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
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rawBody = (await request.json().catch(() => ({}))) as LeaderboardRequestBody
    const requestedOrgId = readOptionalString(rawBody.orgId)
    const requestedRole = readOptionalString(rawBody.role)

    const admin = getAdminClient()
    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, org_id, role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const userProfile = profile as UserProfile
    if (
      (requestedOrgId && requestedOrgId !== userProfile.org_id) ||
      (requestedRole && requestedRole !== userProfile.role)
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: userRows, error: usersError } = await admin
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', userProfile.org_id)
      .order('full_name', { ascending: true })

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const orgUsers = (userRows ?? []) as unknown as OrgUser[]
    const memberIds = orgUsers.map((orgUser) => orgUser.id)
    if (memberIds.length === 0) {
      return NextResponse.json({ setters: [], closers: [] } satisfies LeaderboardResponse)
    }

    const { start, end } = getDateRangeForTimeFrame('week', TIMEZONE, false)
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

    const setters = rankEntries(
      orgUsers.filter((orgUser) => isSetterLikeRole(orgUser.role)),
      inspectionsByUserId,
      doorsByUserId,
    )
    const closers = rankEntries(
      orgUsers.filter((orgUser) => CLOSER_ROLES.has(orgUser.role)),
      salesByUserId,
      doorsByUserId,
    )

    return NextResponse.json({ setters, closers } satisfies LeaderboardResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
