import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type AuthResult = {
  userId: string
  orgId: string
}

type SessionData = {
  access_token?: string
}

type OrgUser = {
  id: string
  full_name: string | null
  role: string | null
}

type LeadMetricRow = {
  owner_user_id: string | null
}

type AppointmentMetricRow = {
  canvasser_user_id: string | null
}

type Program444Enrollment = {
  user_id: string
  week1_starts_at: string
  week1_ends_at: string
  week2_starts_at: string
  week2_ends_at: string
  week1_qualified: boolean
  week2_qualified: boolean
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

const ACCOUNTABILITY_ROLES = ['setter', 'canvasser', 'inside_sales', 'call_center']
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

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
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

  const admin = getAdminClient()
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

  return { userId: user.id, orgId: profile.org_id }
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
  const saturday = addDays(sunday, 6)

  return {
    startsAt: zonedDateTimeToIso(sunday, timezone, 0, 0, 0),
    endsAt: zonedDateTimeToIso(saturday, timezone, 23, 59, 59),
  }
}

function incrementCount(map: Map<string, number>, userId: string | null) {
  if (!userId) return
  map.set(userId, (map.get(userId) ?? 0) + 1)
}

function getCurrentEnrollment(enrollments: Program444Enrollment[], now: number): Program444Enrollment | null {
  return enrollments.find((enrollment) => {
    const week1Starts = new Date(enrollment.week1_starts_at).getTime()
    const week2Ends = new Date(enrollment.week2_ends_at).getTime()
    return now >= week1Starts && now <= week2Ends
  }) ?? enrollments[0] ?? null
}

function getWeekIn444(enrollment: Program444Enrollment | null, now: number): 1 | 2 | null {
  if (!enrollment) return null

  const week1Starts = new Date(enrollment.week1_starts_at).getTime()
  const week1Ends = new Date(enrollment.week1_ends_at).getTime()
  const week2Starts = new Date(enrollment.week2_starts_at).getTime()
  const week2Ends = new Date(enrollment.week2_ends_at).getTime()

  if (now >= week1Starts && now <= week1Ends) return 1
  if (now >= week2Starts && now <= week2Ends) return 2
  return null
}

export async function GET(req: NextRequest) {
  const authResult = await assertAdmin(req)
  if (authResult instanceof NextResponse) return authResult

  const admin = getAdminClient()
  const weekRange = getCurrentWeekRange()

  const todayIso = new Date().toISOString().slice(0, 10)

  const [usersRes, leadsRes, appointmentsRes, enrollmentsRes, goalsRes] = await Promise.all([
    admin
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', authResult.orgId)
      .eq('is_active', true)
      .in('role', ACCOUNTABILITY_ROLES)
      .order('full_name'),
    admin
      .from('leads')
      .select('owner_user_id')
      .eq('org_id', authResult.orgId)
      .in('source', DOOR_SOURCES)
      .gte('created_at', weekRange.startsAt)
      .lte('created_at', weekRange.endsAt),
    admin
      .from('scheduled_appointments')
      .select('canvasser_user_id')
      .eq('org_id', authResult.orgId)
      .gte('created_at', weekRange.startsAt)
      .lte('created_at', weekRange.endsAt),
    admin
      .from('program_444_enrollments')
      .select('user_id, week1_starts_at, week1_ends_at, week2_starts_at, week2_ends_at, week1_qualified, week2_qualified')
      .eq('org_id', authResult.orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    admin
      .from('user_incentive_goals')
      .select('user_id, weekly_doors_target, weekly_inspections_target, weekly_sales_target')
      .eq('org_id', authResult.orgId)
      .lte('effective_from', todayIso)
      .or(`effective_to.is.null,effective_to.gte.${todayIso}`)
      .order('effective_from', { ascending: false }),
  ])

  const firstError = usersRes.error ?? leadsRes.error ?? appointmentsRes.error ?? enrollmentsRes.error ?? goalsRes.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  const users = (usersRes.data ?? []) as OrgUser[]
  const leads = (leadsRes.data ?? []) as LeadMetricRow[]
  const appointments = (appointmentsRes.data ?? []) as AppointmentMetricRow[]
  const enrollments = (enrollmentsRes.data ?? []) as Program444Enrollment[]
  const goalRows = (goalsRes.data ?? []) as GoalRow[]

  // Latest goal per user (already ordered by effective_from desc)
  const goalByUser = new Map<string, GoalRow>()
  for (const g of goalRows) {
    if (!goalByUser.has(g.user_id)) goalByUser.set(g.user_id, g)
  }

  const doorsByUser = new Map<string, number>()
  const inspectionsByUser = new Map<string, number>()
  const enrollmentsByUser = new Map<string, Program444Enrollment[]>()
  const now = Date.now()

  leads.forEach((lead) => incrementCount(doorsByUser, lead.owner_user_id))
  appointments.forEach((appointment) => incrementCount(inspectionsByUser, appointment.canvasser_user_id))
  enrollments.forEach((enrollment) => {
    const current = enrollmentsByUser.get(enrollment.user_id) ?? []
    current.push(enrollment)
    enrollmentsByUser.set(enrollment.user_id, current)
  })

  // Pace factor: how far through the work-week are we (Mon=1 … Fri=5, clamp 0–1)
  const dayOfWeek = new Date().getDay() // 0=Sun, 6=Sat
  const workDayIndex = Math.max(1, Math.min(5, dayOfWeek === 0 ? 1 : dayOfWeek))
  const paceFactor = workDayIndex / 5

  const accountability = users.map((user) => {
    const userEnrollments = enrollmentsByUser.get(user.id) ?? []
    const enrollment = getCurrentEnrollment(userEnrollments, now)
    const goal = goalByUser.get(user.id) ?? null

    const doors = doorsByUser.get(user.id) ?? 0
    const inspections = inspectionsByUser.get(user.id) ?? 0

    const doorsPct = goal?.weekly_doors_target
      ? Math.round((doors / goal.weekly_doors_target) * 100)
      : null
    const inspectionsPct = goal?.weekly_inspections_target
      ? Math.round((inspections / goal.weekly_inspections_target) * 100)
      : null

    // 444 pct: 50% weight each gate, capped 100
    const weekInPgm = getWeekIn444(enrollment, now)
    const pgmDoors = weekInPgm === 2 ? (enrollment?.week2_qualified ? 400 : doors) : doors
    const pgmInspections = weekInPgm === 2 ? (enrollment?.week2_qualified ? 4 : inspections) : inspections
    const program_444_pct = userEnrollments.length > 0
      ? Math.min(100, Math.round((pgmDoors / 400) * 50 + (pgmInspections / 4) * 50))
      : null

    return {
      user_id: user.id,
      full_name: user.full_name,
      role: user.role,
      doors_knocked: doors,
      inspections_set: inspections,
      is_enrolled_444: userEnrollments.length > 0,
      week_in_444: weekInPgm,
      week1_qualified: enrollment?.week1_qualified ?? false,
      week2_qualified: enrollment?.week2_qualified ?? false,
      doors_goal: goal?.weekly_doors_target ?? null,
      inspections_goal: goal?.weekly_inspections_target ?? null,
      sales_goal: goal?.weekly_sales_target ?? null,
      doors_pct: doorsPct,
      inspections_pct: inspectionsPct,
      program_444_pct,
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
    enrolled_444: accountability.filter((r) => r.is_enrolled_444).length,
    completed_444: accountability.filter((r) => r.week1_qualified && r.week2_qualified).length,
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
