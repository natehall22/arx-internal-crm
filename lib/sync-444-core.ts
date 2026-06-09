import type { SupabaseClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────
// Configurable via PROGRAM_444_BONUS_AMOUNT env var. Defaults to $400.
// Update the env var to change the bonus without a redeploy.
const WEEK_BONUS_AMOUNT = (() => {
  const raw = process.env.PROGRAM_444_BONUS_AMOUNT
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 400
})()

// ── Types ─────────────────────────────────────────────────────────────────────

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

export type QualifiedResult = {
  user_id: string
  week: 1 | 2
}

export type SyncOrgResult = {
  synced: number
  qualified: QualifiedResult[]
}

const DOOR_KNOCK_SOURCES = ['door_to_door', 'canvass', 'door_knock']

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

export async function syncOrgEnrollments(
  admin: SupabaseClient,
  orgId: string,
  callerUserId: string | null,
): Promise<SyncOrgResult> {
  const nowIso = new Date().toISOString()

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
    .eq('org_id', orgId)
    .eq('status', 'active')

  if (enrollmentError) throw new Error(enrollmentError.message)

  const enrollments = (enrollmentRows ?? []) as unknown as Enrollment[]
  if (enrollments.length === 0) return { synced: 0, qualified: [] }

  const allStarts = enrollments.flatMap((e) => [e.week1_starts_at, e.week2_starts_at])
  const allEnds = enrollments.flatMap((e) => [e.week1_ends_at, e.week2_ends_at])
  const rangeStart = allStarts.reduce((min, d) => (d < min ? d : min))
  const rangeEnd = allEnds.reduce((max, d) => (d > max ? d : max))

  const [leadsResult, appointmentsResult] = await Promise.all([
    admin
      .from('leads')
      .select('owner_user_id, created_at')
      .eq('org_id', orgId)
      .in('source', DOOR_KNOCK_SOURCES)
      .gte('created_at', rangeStart)
      .lte('created_at', rangeEnd),
    admin
      .from('scheduled_appointments')
      .select('canvasser_user_id, created_at')
      .eq('org_id', orgId)
      .gte('created_at', rangeStart)
      .lte('created_at', rangeEnd),
  ])

  if (leadsResult.error) throw new Error(leadsResult.error.message)
  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message)

  const allLeads = (leadsResult.data ?? []) as LeadRow[]
  const allAppointments = (appointmentsResult.data ?? []) as AppointmentRow[]

  let openPayrollPeriodId: string | null = null
  const { data: periodRows, error: periodError } = await admin
    .from('payroll_periods')
    .select('id')
    .eq('org_id', orgId)
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
    console.warn('[sync-444] No open payroll period found for org', orgId, '— bonus lines will be skipped')
  }

  const qualified: QualifiedResult[] = []
  let synced = 0

  for (const enrollment of enrollments) {
    const week1Doors = countLeads(allLeads, enrollment.user_id, enrollment.week1_starts_at, enrollment.week1_ends_at)
    const week1Inspections = countAppointments(allAppointments, enrollment.user_id, enrollment.week1_starts_at, enrollment.week1_ends_at)
    const week2Doors = countLeads(allLeads, enrollment.user_id, enrollment.week2_starts_at, enrollment.week2_ends_at)
    const week2Inspections = countAppointments(allAppointments, enrollment.user_id, enrollment.week2_starts_at, enrollment.week2_ends_at)

    const week1NowQualified = week1Doors >= 400 && week1Inspections >= 4
    const week2NowQualified = week2Doors >= 400 && week2Inspections >= 4

    const week1NewlyQualified = !enrollment.week1_qualified && week1NowQualified
    const week2NewlyQualified = !enrollment.week2_qualified && week2NowQualified

    const enrollmentUpdate: Record<string, unknown> = {
      week1_doors: week1Doors,
      week1_inspections: week1Inspections,
      week2_doors: week2Doors,
      week2_inspections: week2Inspections,
    }

    if (week1NewlyQualified) {
      enrollmentUpdate.week1_qualified = true
      enrollmentUpdate.week1_paid_at = nowIso
      if (openPayrollPeriodId) enrollmentUpdate.week1_payroll_period_id = openPayrollPeriodId
    }

    if (week2NewlyQualified) {
      enrollmentUpdate.week2_qualified = true
      enrollmentUpdate.week2_paid_at = nowIso
      if (openPayrollPeriodId) enrollmentUpdate.week2_payroll_period_id = openPayrollPeriodId
    }

    const week1Done = enrollment.week1_qualified || week1NewlyQualified
    const week2Done = enrollment.week2_qualified || week2NewlyQualified
    if (week1Done && week2Done) enrollmentUpdate.status = 'completed'

    // ── Optimistic lock (Fix #5 — race condition) ─────────────────────────────
    // Add WHERE conditions for any flags we're about to flip. If a concurrent
    // sync already flipped them, 0 rows are updated and we skip bonus/notification
    // entirely — preventing duplicate payouts and duplicate notifications.
    const baseQuery = admin
      .from('program_444_enrollments')
      .update(enrollmentUpdate)
      .eq('id', enrollment.id)

    const lockedQuery =
      week1NewlyQualified && week2NewlyQualified
        ? baseQuery.eq('week1_qualified', false).eq('week2_qualified', false)
        : week1NewlyQualified
        ? baseQuery.eq('week1_qualified', false)
        : week2NewlyQualified
        ? baseQuery.eq('week2_qualified', false)
        : baseQuery

    const { data: updatedRows, error: updateError } = await lockedQuery.select('id')

    if (updateError) {
      console.error(`[sync-444] Failed to update enrollment ${enrollment.id}:`, updateError.message)
      continue
    }

    synced += 1

    // If 0 rows came back a concurrent sync beat us — skip bonus + notification
    // to prevent duplicates (Fix #2 — duplicate notifications)
    const didUpdate = (updatedRows?.length ?? 0) > 0

    if (week1NewlyQualified && didUpdate) {
      qualified.push({ user_id: enrollment.user_id, week: 1 })

      // ── Bonus line ──────────────────────────────────────────────────────────
      let bonusRegistered = false
      if (openPayrollPeriodId) {
        const { error: bonusError } = await admin.from('payroll_bonus_lines').insert({
          org_id: orgId,
          payroll_period_id: openPayrollPeriodId,
          user_id: enrollment.user_id,
          bonus_type: '444_week1',
          amount: WEEK_BONUS_AMOUNT,
          description: `ARX 444 Program Week 1 Bonus`,
          source_id: enrollment.id,
          created_by: callerUserId,
        })
        if (!bonusError || bonusError.code === '23505') {
          bonusRegistered = true
        } else {
          console.error('[sync-444] Failed to insert week1 bonus line:', bonusError.message)
        }
      }

      // ── Notification (Fix #1 — only fire when bonus is confirmed or payroll
      //    period missing; body is honest about registration status) ───────────
      const bonusBody = bonusRegistered
        ? `You qualified for the $${WEEK_BONUS_AMOUNT} Week 1 bonus. It has been registered for payroll.`
        : openPayrollPeriodId
        ? `You qualified for Week 1! Bonus registration encountered an issue — contact your manager.`
        : `You qualified for Week 1! Your $${WEEK_BONUS_AMOUNT} bonus will be registered once the payroll period opens.`

      const { error: notifError } = await admin.from('notifications').insert({
        org_id: orgId,
        recipient_user_id: enrollment.user_id,
        actor_user_id: callerUserId,
        type: 'sisu_444_qualified',
        title: 'You hit the 444!',
        body: bonusBody,
      })
      if (notifError) {
        console.error('[sync-444] Failed to insert week1 notification:', notifError.message)
      }
    }

    if (week2NewlyQualified && didUpdate) {
      qualified.push({ user_id: enrollment.user_id, week: 2 })

      // ── Bonus line ──────────────────────────────────────────────────────────
      let bonusRegistered = false
      if (openPayrollPeriodId) {
        const { error: bonusError } = await admin.from('payroll_bonus_lines').insert({
          org_id: orgId,
          payroll_period_id: openPayrollPeriodId,
          user_id: enrollment.user_id,
          bonus_type: '444_week2',
          amount: WEEK_BONUS_AMOUNT,
          description: `ARX 444 Program Week 2 Bonus`,
          source_id: enrollment.id,
          created_by: callerUserId,
        })
        if (!bonusError || bonusError.code === '23505') {
          bonusRegistered = true
        } else {
          console.error('[sync-444] Failed to insert week2 bonus line:', bonusError.message)
        }
      }

      // ── Notification ────────────────────────────────────────────────────────
      const bonusBody = bonusRegistered
        ? `You qualified for the $${WEEK_BONUS_AMOUNT} Week 2 bonus. Incredible work — it has been registered for payroll.`
        : openPayrollPeriodId
        ? `You qualified for Week 2! Bonus registration encountered an issue — contact your manager.`
        : `You qualified for Week 2! Your $${WEEK_BONUS_AMOUNT} bonus will be registered once the payroll period opens.`

      const { error: notifError } = await admin.from('notifications').insert({
        org_id: orgId,
        recipient_user_id: enrollment.user_id,
        actor_user_id: callerUserId,
        type: 'sisu_444_qualified',
        title: 'You hit the 444!',
        body: bonusBody,
      })
      if (notifError) {
        console.error('[sync-444] Failed to insert week2 notification:', notifError.message)
      }
    }
  }

  return { synced, qualified }
}
