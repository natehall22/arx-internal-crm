import type { SupabaseClient } from '@supabase/supabase-js'
import { getAttributedCanvassLeadUserId } from '@/lib/canvass-lead-attribution'

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
  week1_qualified_at: string | null
  week1_payroll_period_id: string | null
  week2_doors: number
  week2_inspections: number
  week2_qualified: boolean
  week2_qualified_at: string | null
  week2_payroll_period_id: string | null
  status: 'active' | 'completed' | 'cancelled'
}

type LeadRow = {
  owner_user_id: string | null
  pin_attributed_user_id: string | null
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

// 444 program qualification thresholds — shared constants so they're easy to find and change
export const PROGRAM_444_DOOR_THRESHOLD = 400
export const PROGRAM_444_INSPECTION_THRESHOLD = 4

function countLeads(
  leadsByUser: Map<string, LeadRow[]>,
  userId: string,
  startsAt: string,
  endsAt: string,
): number {
  const leads = leadsByUser.get(userId) ?? []
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  return leads.filter((l) => {
    const ts = new Date(l.created_at).getTime()
    return ts >= start && ts < end  // exclusive end — matches stored exclusive boundary
  }).length
}

function countAppointments(
  appointmentsByUser: Map<string, AppointmentRow[]>,
  userId: string,
  startsAt: string,
  endsAt: string,
): number {
  const appointments = appointmentsByUser.get(userId) ?? []
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  return appointments.filter((a) => {
    const ts = new Date(a.created_at).getTime()
    return ts >= start && ts < end  // exclusive end — matches stored exclusive boundary
  }).length
}

export async function syncOrgEnrollments(
  admin: SupabaseClient,
  orgId: string,
  callerUserId: string | null,
): Promise<SyncOrgResult> {
  const nowIso = new Date().toISOString()

  // ── Fetch org settings + active enrollments in parallel ──────────────────
  const [orgResult, enrollmentResult] = await Promise.all([
    admin
      .from('orgs')
      .select('program_444_week_bonus_amount, program_444_week_bonus_label')
      .eq('id', orgId)
      .single(),
    admin
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
          'week1_qualified_at',
          'week1_payroll_period_id',
          'week2_doors',
          'week2_inspections',
          'week2_qualified',
          'week2_qualified_at',
          'week2_payroll_period_id',
          'status',
        ].join(', '),
      )
      .eq('org_id', orgId)
      .eq('status', 'active'),
  ])

  if (orgResult.error || !orgResult.data) {
    throw new Error(`sync-444: failed to fetch org settings: ${orgResult.error?.message ?? 'org not found'}`)
  }
  if (enrollmentResult.error) throw new Error(enrollmentResult.error.message)

  // Amount used for payroll bonus line records. Null means non-monetary reward —
  // fall back to 0 so the line is still written but carries no dollar value.
  const rawAmount = orgResult.data.program_444_week_bonus_amount
  const weekBonusAmount = rawAmount != null && Number.isFinite(Number(rawAmount)) ? Number(rawAmount) : 0
  // Use the org-configured display label in notifications (can be "ARX hoodie", "$400", etc.)
  // Falls back to dollar amount if label is missing, then to generic copy as last resort.
  const weekBonusLabel: string =
    orgResult.data.program_444_week_bonus_label ?? (weekBonusAmount > 0 ? `$${weekBonusAmount}` : 'your reward')

  const enrollments = (enrollmentResult.data ?? []) as unknown as Enrollment[]
  if (enrollments.length === 0) return { synced: 0, qualified: [] }

  const allStarts = enrollments.flatMap((e) => [e.week1_starts_at, e.week2_starts_at])
  const allEnds = enrollments.flatMap((e) => [e.week1_ends_at, e.week2_ends_at])
  const rangeStart = allStarts.reduce((min, d) => (d < min ? d : min))
  const rangeEnd = allEnds.reduce((max, d) => (d > max ? d : max))

  const [leadsResult, appointmentsResult] = await Promise.all([
    admin
      .from('leads')
      .select('owner_user_id, pin_attributed_user_id, created_at')
      .eq('org_id', orgId)
      .in('source', DOOR_KNOCK_SOURCES)
      .gte('created_at', rangeStart)
      .lt('created_at', rangeEnd),    // exclusive end — matches stored exclusive boundary
    admin
      .from('scheduled_appointments')
      .select('canvasser_user_id, created_at')
      .eq('org_id', orgId)
      .gte('created_at', rangeStart)
      .lt('created_at', rangeEnd),    // exclusive end
  ])

  if (leadsResult.error) throw new Error(leadsResult.error.message)
  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message)

  const allLeads = (leadsResult.data ?? []) as LeadRow[]
  const allAppointments = (appointmentsResult.data ?? []) as AppointmentRow[]

  // Use the same attribution logic as the rep dashboard — pin_attributed_user_id
  // takes precedence over owner_user_id (matches getAttributedCanvassLeadUserId)
  const leadsByUser = new Map<string, LeadRow[]>()
  for (const l of allLeads) {
    const userId = getAttributedCanvassLeadUserId(l)
    if (!userId) continue
    const arr = leadsByUser.get(userId) ?? []
    arr.push(l)
    leadsByUser.set(userId, arr)
  }

  const appointmentsByUser = new Map<string, AppointmentRow[]>()
  for (const a of allAppointments) {
    if (!a.canvasser_user_id) continue
    const arr = appointmentsByUser.get(a.canvasser_user_id) ?? []
    arr.push(a)
    appointmentsByUser.set(a.canvasser_user_id, arr)
  }

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
    const week1Doors = countLeads(leadsByUser, enrollment.user_id, enrollment.week1_starts_at, enrollment.week1_ends_at)
    const week1Inspections = countAppointments(appointmentsByUser, enrollment.user_id, enrollment.week1_starts_at, enrollment.week1_ends_at)
    const week2Doors = countLeads(leadsByUser, enrollment.user_id, enrollment.week2_starts_at, enrollment.week2_ends_at)
    const week2Inspections = countAppointments(appointmentsByUser, enrollment.user_id, enrollment.week2_starts_at, enrollment.week2_ends_at)

    const week1NowQualified = week1Doors >= PROGRAM_444_DOOR_THRESHOLD && week1Inspections >= PROGRAM_444_INSPECTION_THRESHOLD
    const week2NowQualified = week2Doors >= PROGRAM_444_DOOR_THRESHOLD && week2Inspections >= PROGRAM_444_INSPECTION_THRESHOLD

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
      enrollmentUpdate.week1_qualified_at = nowIso
      if (openPayrollPeriodId) enrollmentUpdate.week1_payroll_period_id = openPayrollPeriodId
    }

    if (week2NewlyQualified) {
      enrollmentUpdate.week2_qualified = true
      enrollmentUpdate.week2_qualified_at = nowIso
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

    // Lock on every flag we're about to flip AND any flag already set — prevents
    // split-sync races where two concurrent syncs each write one bonus line.
    const lockedQuery =
      week1NewlyQualified && week2NewlyQualified
        ? baseQuery.eq('week1_qualified', false).eq('week2_qualified', false)
        : week1NewlyQualified
        ? baseQuery.eq('week1_qualified', false)
        : week2NewlyQualified
        // Also assert week1_qualified matches what we read — a concurrent sync
        // that just flipped week1 must not allow this sync to also write week2 alone
        ? baseQuery.eq('week2_qualified', false).eq('week1_qualified', enrollment.week1_qualified)
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
          amount: weekBonusAmount,
          description: `ARX 444 Program Week 1 Bonus`,
          source_id: enrollment.id,
          created_by: callerUserId,
          status: 'pending_approval',
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
        ? `You qualified for the ${weekBonusLabel} Week 1 bonus. It has been registered for payroll.`
        : openPayrollPeriodId
        ? `You qualified for Week 1! Bonus registration encountered an issue — contact your manager.`
        : `You qualified for Week 1! Your ${weekBonusLabel} bonus will be registered once the payroll period opens.`

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
          amount: weekBonusAmount,
          description: `ARX 444 Program Week 2 Bonus`,
          source_id: enrollment.id,
          created_by: callerUserId,
          status: 'pending_approval',
        })
        if (!bonusError || bonusError.code === '23505') {
          bonusRegistered = true
        } else {
          console.error('[sync-444] Failed to insert week2 bonus line:', bonusError.message)
        }
      }

      // ── Notification ────────────────────────────────────────────────────────
      const bonusBody = bonusRegistered
        ? `You qualified for the ${weekBonusLabel} Week 2 bonus. Incredible work — it has been registered for payroll.`
        : openPayrollPeriodId
        ? `You qualified for Week 2! Bonus registration encountered an issue — contact your manager.`
        : `You qualified for Week 2! Your ${weekBonusLabel} bonus will be registered once the payroll period opens.`

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
