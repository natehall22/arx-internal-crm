import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEasternPaceFactor, getEasternTodayIso } from '@/lib/eastern-datetime'
import { INSPECTION_SET_APPOINTMENT_TYPE_OR } from '@/lib/inspection-set-metrics'
import type { DbUserRole } from '@/lib/types/database'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type AuthResult = {
  userId: string
  orgId: string
  role: string
}

type SessionData = {
  access_token?: string
}

type OrgUser = {
  id: string
  full_name: string | null
  role: string | null
}

type KnockMetricRow = {
  user_id: string | null
}

type AppointmentMetricRow = {
  canvasser_user_id: string | null
}

type GoalRow = {
  user_id: string
  weekly_doors_target: number | null
  weekly_inspections_target: number | null
  weekly_sales_target: number | null
}

const ADMIN_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
]

// Roles that see only their direct reports (manager_user_id = viewer.id)
const MANAGER_SCOPED_ROLES = new Set(['setter_manager', 'sales_manager', 'regional_setter_manager'])

// Typed as DbUserRole: Postgres rejects the whole query (22P02) if any value is
// not a real `user_role` enum label. Inside Sales is a permission-based custom
// role layered on setter/canvasser, not its own enum value.
const ACCOUNTABILITY_ROLES: DbUserRole[] = ['setter', 'canvasser']
const DOOR_SOURCES = ['door_to_door', 'canvass', 'door_knock']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getSessionFromRequest(req: NextRequest): SessionData | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`

  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(singleCookie.value))
      return isRecord(parsed) ? { access_token: String(parsed.access_token ?? '') } : null
    } catch {
      return null
    }
  }

  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i += 1
  }

  if (chunks.length > 0) {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(chunks.join('')))
      return isRecord(parsed) ? { access_token: String(parsed.access_token ?? '') } : null
    } catch {
      return null
    }
  }

  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: sessionData?.access_token
      ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
      : undefined,
  })
}

async function getAuthedUser(req: NextRequest) {
  const client = getAuthClient(req)
  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error || !user) return null
  return user
}

async function assertAdmin(req: NextRequest): Promise<AuthResult | NextResponse> {
  const user = await getAuthedUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!profile.org_id) {
    return NextResponse.json({ error: 'No org found' }, { status: 400 })
  }

  return { userId: user.id, orgId: profile.org_id, role: profile.role }
}

function getTimeZoneDateParts(date: Date, timezone: string): { year: number; month: number; day: number; weekday: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const partMap = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const weekday = partMap.get('weekday')
  const year = partMap.get('year')
  const month = partMap.get('month')
  const day = partMap.get('day')

  if (!weekday || !year || !month || !day) {
    throw new Error('Unable to compute week range')
  }

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    weekday,
  }
}

function addDays(dateParts: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + days, 12, 0, 0))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function getOffsetMilliseconds(utcDate: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const partMap = new Map(formatter.formatToParts(utcDate).map((part) => [part.type, part.value]))
  const year = partMap.get('year')
  const month = partMap.get('month')
  const day = partMap.get('day')
  const hour = partMap.get('hour')
  const minute = partMap.get('minute')
  const second = partMap.get('second')

  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error('Unable to compute timezone offset')
  }

  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ) - utcDate.getTime()
}

function zonedDateTimeToIso(
  dateParts: { year: number; month: number; day: number },
  timezone: string,
  hour: number,
  minute: number,
  second: number
): string {
  const localAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, second)
  let utcTime = localAsUtc - getOffsetMilliseconds(new Date(localAsUtc), timezone)
  utcTime = localAsUtc - getOffsetMilliseconds(new Date(utcTime), timezone)
  return new Date(utcTime).toISOString()
}

function getCurrentWeekRange(timezone = 'America/New_York'): { startsAt: string; endsAt: string } {
  const todayParts = getTimeZoneDateParts(new Date(), timezone)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(todayParts.weekday)
  if (weekdayIndex < 0) throw new Error('Unable to compute weekday')

  const sunday = addDays(todayParts, -weekdayIndex)
  // Use exclusive end (Sunday 00:00 next week) so sub-second timestamps on
  // Saturday 23:59:59.xxx are never silently dropped.
  const nextSunday = addDays(sunday, 7)

  return {
    startsAt: zonedDateTimeToIso(sunday, timezone, 0, 0, 0),
    endsAt: zonedDateTimeToIso(nextSunday, timezone, 0, 0, 0),
  }
}

function incrementCount(map: Map<string, number>, userId: string | null) {
  if (!userId) return
  map.set(userId, (map.get(userId) ?? 0) + 1)
}

export async function GET(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const admin = createServiceClient()
  const weekRange = getCurrentWeekRange()

  const todayIso = getEasternTodayIso()

  const usersQuery = (() => {
    const base = admin
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', authResult.orgId)
      .eq('active', true)
      .in('role', ACCOUNTABILITY_ROLES)
      .order('full_name')
    return MANAGER_SCOPED_ROLES.has(authResult.role)
      ? base.eq('manager_user_id', authResult.userId)
      : base
  })()

  const [usersRes, leadsRes, appointmentsRes, goalsRes] = await Promise.all([
    usersQuery,
    // canvass_knocks (202608250001_canvass_knocks.sql), not leads: a re-knock of a
    // pre-existing pin UPDATEs the lead row in place with no new created_at, so counting
    // leads directly always missed it. user_id is already resolved (pin_attributed_user_id
    // falling back to owner_user_id) at knock time.
    admin
      .from('canvass_knocks')
      .select('user_id')
      .eq('org_id', authResult.orgId)
      .in('source', DOOR_SOURCES)
      .gte('created_at', weekRange.startsAt)
      .lt('created_at', weekRange.endsAt),  // exclusive end
    admin
      .from('scheduled_appointments')
      .select('canvasser_user_id')
      .eq('org_id', authResult.orgId)
      .gte('created_at', weekRange.startsAt)
      .lt('created_at', weekRange.endsAt) // exclusive end
      .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
      .neq('status', 'cancelled'),
    admin
      .from('user_incentive_goals')
      .select('user_id, weekly_doors_target, weekly_inspections_target, weekly_sales_target')
      .eq('org_id', authResult.orgId)
      .lte('effective_from', todayIso)
      .or(`effective_to.is.null,effective_to.gte.${todayIso}`)
      .order('effective_from', { ascending: false }),
  ])

  const firstError = usersRes.error ?? leadsRes.error ?? appointmentsRes.error ?? goalsRes.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  const users = (usersRes.data ?? []) as OrgUser[]
  const leads = (leadsRes.data ?? []) as KnockMetricRow[]
  const appointments = (appointmentsRes.data ?? []) as AppointmentMetricRow[]
  const goalRows = (goalsRes.data ?? []) as GoalRow[]

  // Latest goal per user (already ordered by effective_from desc)
  const goalByUser = new Map<string, GoalRow>()
  for (const g of goalRows) {
    if (!goalByUser.has(g.user_id)) goalByUser.set(g.user_id, g)
  }

  const doorsByUser = new Map<string, number>()
  const inspectionsByUser = new Map<string, number>()
  const now = Date.now()

  // canvass_knocks.user_id is already the resolved attributed rep at knock time — matches sync/leaderboard/dashboard logic
  leads.forEach((lead) => incrementCount(doorsByUser, lead.user_id))
  appointments.forEach((appointment) => incrementCount(inspectionsByUser, appointment.canvasser_user_id))

  // Pace factor: how far through the work-week are we (Mon=1 … Fri=5, clamp 0–1)
  // Sunday (0) → 0 (new week, no expectation yet) — mirrors getWeeklyPaceThresholdPct()
  // Saturday (6) → 1.0 (full week expectation)
  // Use ET timezone — server may run in UTC so getDay() would be wrong near midnight ET
  const paceFactor = getEasternPaceFactor()

  const accountability = users.map((user) => {
    const goal = goalByUser.get(user.id) ?? null

    const doors = doorsByUser.get(user.id) ?? 0
    const inspections = inspectionsByUser.get(user.id) ?? 0

    const doorsPct = goal?.weekly_doors_target
      ? Math.round((doors / goal.weekly_doors_target) * 100)
      : null
    const inspectionsPct = goal?.weekly_inspections_target
      ? Math.round((inspections / goal.weekly_inspections_target) * 100)
      : null


    return {
      user_id: user.id,
      full_name: user.full_name,
      role: user.role,
      doors_knocked: doors,
      inspections_set: inspections,
      doors_goal: goal?.weekly_doors_target ?? null,
      inspections_goal: goal?.weekly_inspections_target ?? null,
      sales_goal: goal?.weekly_sales_target ?? null,
      doors_pct: doorsPct,
      inspections_pct: inspectionsPct,
      on_pace_doors: doorsPct !== null ? doorsPct >= Math.round(paceFactor * 100) : null,
      on_pace_inspections: inspectionsPct !== null ? inspectionsPct >= Math.round(paceFactor * 100) : null,
    }
  })

  // Team health summary
  const withDoorGoal = accountability.filter((r) => r.doors_pct !== null)
  const withInspGoal = accountability.filter((r) => r.inspections_pct !== null)
  const summary = {
    total_reps: accountability.length,
    on_pace_doors: withDoorGoal.filter((r) => r.on_pace_doors).length,
    on_pace_inspections: withInspGoal.filter((r) => r.on_pace_inspections).length,
    reps_with_door_goal: withDoorGoal.length,
    reps_with_insp_goal: withInspGoal.length,
    // Behind pace on any metric with a goal set — needs attention
    needs_attention: accountability.filter(
      (r) => (r.on_pace_doors === false) || (r.on_pace_inspections === false)
    ).length,
    // Close to a milestone: 80–99% toward their door or inspection goal
    close_to_goal: accountability.filter(
      (r) =>
        (r.doors_pct !== null && r.doors_pct >= 80 && r.doors_pct < 100) ||
        (r.inspections_pct !== null && r.inspections_pct >= 80 && r.inspections_pct < 100)
    ).length,
  }

  return NextResponse.json({
    week: weekRange,
    summary,
    accountability,
  })
}
