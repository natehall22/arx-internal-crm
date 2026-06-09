import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

type AuthResult = {
  userId: string
  orgId: string
}

type SessionData = {
  access_token?: string
}

type Enrollment = {
  id: string
  org_id: string
  user_id: string
  week1_starts_at: string
  week1_ends_at: string
  week2_starts_at: string
  week2_ends_at: string
  week1_doors: number
  week1_inspections: number
  week1_qualified: boolean
  week1_paid_at: string | null
  week1_payroll_period_id: string | null
  week2_doors: number
  week2_inspections: number
  week2_qualified: boolean
  week2_paid_at: string | null
  week2_payroll_period_id: string | null
  status: 'active' | 'completed' | 'cancelled'
}

type LeadRow = {
  owner_user_id: string | null
  created_at: string
}

type AppointmentRow = {
  canvasser_user_id: string | null
  created_at: string
}

type PayrollPeriodRow = {
  id: string
}

type QualifiedResult = {
  user_id: string
  week: 1 | 2
}

// ── Auth helpers (same pattern as app/api/admin/sisu/444/route.ts) ─────────────

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

const DOOR_KNOCK_SOURCES = ['door_to_door', 'canvass', 'door_knock']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getSessionFromRequest(req: NextRequest): SessionData | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] ?? ''
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

async function assertAdmin(req: NextRequest): Promise<AuthResult | NextResponse> {
  const authClient = getAuthClient(req)
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()

  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role || !ADMIN_ROLES.includes(profile.role as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!profile.org_id) {
    return NextResponse.json({ error: 'No org found' }, { status: 400 })
  }

  return { userId: user.id, orgId: profile.org_id as string }
}

// ── Sync logic ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authResult = await assertAdmin(req)
    if (authResult instanceof NextResponse) return authResult

    const admin = getAdminClient()
    const nowIso = new Date().toISOString()

    // 1. Fetch all active enrollments for this org
    const { data: enrollmentRows, error: enrollmentError } = await admin
      .from('program_444_enrollments')
      .select(
        [
          'id',
          'org_id',
          'user_id',
          'week1_starts_at',
          'week1_ends_at',
          'week2_starts_at',
          'week2_ends_at',
          'week1_doors',
          'week1_inspections',
          'week1_qualified',
          'week1_paid_at',
          'week1_payroll_period_id',
          'week2_doors',
          'week2_inspections',
          'week2_qualified',
          'week2_paid_at',
          'week2_payroll_period_id',
          'status',
        ].join(', '),
      )
      .eq('org_id', authResult.orgId)
      .eq('status', 'active')

    if (enrollmentError) {
      return NextResponse.json({ error: enrollmentError.message }, { status: 500 })
    }

    const enrollments = (enrollmentRows ?? []) as unknown as Enrollment[]

    if (enrollments.length === 0) {
      return NextResponse.json({ synced: 0, qualified: [] })
    }

    // Compute the union date range covering all enrollment windows
    const allStarts = enrollments.flatMap((e) => [e.week1_starts_at, e.week2_starts_at])
    const allEnds = enrollments.flatMap((e) => [e.week1_ends_at, e.week2_ends_at])
    const rangeStart = allStarts.reduce((min, d) => (d < min ? d : min))
    const rangeEnd = allEnds.reduce((max, d) => (d > max ? d : max))

    // 2. Bulk-fetch all leads and appointments in the union range (filter in memory)
    const [leadsResult, appointmentsResult] = await Promise.all([
      admin
        .from('leads')
        .select('owner_user_id, created_at')
        .eq('org_id', authResult.orgId)
        .in('source', DOOR_KNOCK_SOURCES)
        .gte('created_at', rangeStart)
        .lte('created_at', rangeEnd),
      admin
        .from('scheduled_appointments')
        .select('canvasser_user_id, created_at')
        .eq('org_id', authResult.orgId)
        .gte('created_at', rangeStart)
        .lte('created_at', rangeEnd),
    ])

    if (leadsResult.error) {
      return NextResponse.json({ error: leadsResult.error.message }, { status: 500 })
    }
    if (appointmentsResult.error) {
      return NextResponse.json({ error: appointmentsResult.error.message }, { status: 500 })
    }

    const allLeads = (leadsResult.data ?? []) as LeadRow[]
    const allAppointments = (appointmentsResult.data ?? []) as AppointmentRow[]

    // Find the current open payroll period for the org once (shared across enrollments)
    let openPayrollPeriodId: string | null = null
    const { data: periodRows, error: periodError } = await admin
      .from('payroll_periods')
      .select('id')
      .eq('org_id', authResult.orgId)
      .eq('status', 'open')
      .order('cutoff_at', { ascending: true })
      .limit(1)

    if (periodError) {
      console.warn('[sync-444] Could not fetch open payroll period:', periodError.message)
    } else {
      const periods = (periodRows ?? []) as PayrollPeriodRow[]
      openPayrollPeriodId = periods[0]?.id ?? null
    }

    if (!openPayrollPeriodId) {
      console.warn('[sync-444] No open payroll period found — bonus lines will be skipped')
    }

    // 3. Process each enrollment
    const qualified: QualifiedResult[] = []
    let synced = 0

    for (const enrollment of enrollments) {
      // Count metrics per week by filtering in memory
      const week1Doors = countLeads(allLeads, enrollment.user_id, enrollment.week1_starts_at, enrollment.week1_ends_at)
      const week1Inspections = countAppointments(allAppointments, enrollment.user_id, enrollment.week1_starts_at, enrollment.week1_ends_at)
      const week2Doors = countLeads(allLeads, enrollment.user_id, enrollment.week2_starts_at, enrollment.week2_ends_at)
      const week2Inspections = countAppointments(allAppointments, enrollment.user_id, enrollment.week2_starts_at, enrollment.week2_ends_at)

      const week1NowQualified = week1Doors >= 400 && week1Inspections >= 4
      const week2NowQualified = week2Doors >= 400 && week2Inspections >= 4

      const week1NewlyQualified = !enrollment.week1_qualified && week1NowQualified
      const week2NewlyQualified = !enrollment.week2_qualified && week2NowQualified

      // Build the update payload
      const enrollmentUpdate: Record<string, unknown> = {
        week1_doors: week1Doors,
        week1_inspections: week1Inspections,
        week2_doors: week2Doors,
        week2_inspections: week2Inspections,
      }

      if (week1NewlyQualified) {
        enrollmentUpdate.week1_qualified = true
        enrollmentUpdate.week1_paid_at = nowIso
        if (openPayrollPeriodId) {
          enrollmentUpdate.week1_payroll_period_id = openPayrollPeriodId
        }
      }

      if (week2NewlyQualified) {
        enrollmentUpdate.week2_qualified = true
        enrollmentUpdate.week2_paid_at = nowIso
        if (openPayrollPeriodId) {
          enrollmentUpdate.week2_payroll_period_id = openPayrollPeriodId
        }
      }

      // Mark completed if both weeks are now qualified
      const week1Done = enrollment.week1_qualified || week1NewlyQualified
      const week2Done = enrollment.week2_qualified || week2NewlyQualified
      if (week1Done && week2Done) {
        enrollmentUpdate.status = 'completed'
      }

      // Update the enrollment row
      const { error: updateError } = await admin
        .from('program_444_enrollments')
        .update(enrollmentUpdate)
        .eq('id', enrollment.id)

      if (updateError) {
        console.error(`[sync-444] Failed to update enrollment ${enrollment.id}:`, updateError.message)
        continue
      }

      synced += 1

      // Handle newly-qualified week 1
      if (week1NewlyQualified) {
        qualified.push({ user_id: enrollment.user_id, week: 1 })

        if (openPayrollPeriodId) {
          const { error: bonusError } = await admin.from('payroll_bonus_lines').insert({
            org_id: authResult.orgId,
            payroll_period_id: openPayrollPeriodId,
            user_id: enrollment.user_id,
            bonus_type: '444_week1',
            amount: 400,
            description: 'ARX 444 Program Week 1 Bonus',
            source_id: enrollment.id,
            created_by: authResult.userId,
          })
          // PG error code 23505 = unique_violation — idempotent, safe to ignore
          if (bonusError && bonusError.code !== '23505') {
            console.error('[sync-444] Failed to insert week1 bonus line:', bonusError.message)
          } else if (bonusError?.code === '23505') {
            console.log('[sync-444] Week 1 bonus line already exists for enrollment', enrollment.id)
          }
        }

        const { error: notifError } = await admin.from('notifications').insert({
          org_id: authResult.orgId,
          recipient_user_id: enrollment.user_id,
          actor_user_id: authResult.userId,
          type: 'sisu_444_qualified',
          title: 'You hit the 444!',
          body: 'You qualified for the $400 Week 1 bonus. Keep it up.',
        })
        if (notifError) {
          console.error('[sync-444] Failed to insert week1 notification:', notifError.message)
        }
      }

      // Handle newly-qualified week 2
      if (week2NewlyQualified) {
        qualified.push({ user_id: enrollment.user_id, week: 2 })

        if (openPayrollPeriodId) {
          const { error: bonusError } = await admin.from('payroll_bonus_lines').insert({
            org_id: authResult.orgId,
            payroll_period_id: openPayrollPeriodId,
            user_id: enrollment.user_id,
            bonus_type: '444_week2',
            amount: 400,
            description: 'ARX 444 Program Week 2 Bonus',
            source_id: enrollment.id,
            created_by: authResult.userId,
          })
          // PG error code 23505 = unique_violation — idempotent, safe to ignore
          if (bonusError && bonusError.code !== '23505') {
            console.error('[sync-444] Failed to insert week2 bonus line:', bonusError.message)
          } else if (bonusError?.code === '23505') {
            console.log('[sync-444] Week 2 bonus line already exists for enrollment', enrollment.id)
          }
        }

        const { error: notifError } = await admin.from('notifications').insert({
          org_id: authResult.orgId,
          recipient_user_id: enrollment.user_id,
          actor_user_id: authResult.userId,
          type: 'sisu_444_qualified',
          title: 'You hit the 444!',
          body: 'You qualified for the $400 Week 2 bonus. Incredible work.',
        })
        if (notifError) {
          console.error('[sync-444] Failed to insert week2 notification:', notifError.message)
        }
      }
    }

    return NextResponse.json({ synced, qualified })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── In-memory metric helpers ──────────────────────────────────────────────────

function countLeads(
  leads: LeadRow[],
  userId: string,
  startsAt: string,
  endsAt: string,
): number {
  return leads.filter(
    (l) =>
      l.owner_user_id === userId &&
      l.created_at >= startsAt &&
      l.created_at <= endsAt,
  ).length
}

function countAppointments(
  appointments: AppointmentRow[],
  userId: string,
  startsAt: string,
  endsAt: string,
): number {
  return appointments.filter(
    (a) =>
      a.canvasser_user_id === userId &&
      a.created_at >= startsAt &&
      a.created_at <= endsAt,
  ).length
}
