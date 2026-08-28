import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getAttributedCanvassLeadUserId,
  knocksAsAttributedLeadRows,
  type CanvassKnockRow,
} from '@/lib/canvass-lead-attribution'
import { countsAsInspectionSet, INSPECTION_SET_APPOINTMENT_TYPE_OR } from '@/lib/inspection-set-metrics'
import { pickPayrollPeriodForWeekEnd } from '@/lib/payroll-period-week'
import { roundMoney } from '@/lib/money'
import {
  computeSetterRampWeekWindow,
  tenureWeekNumberForDate,
  evaluateRampGate,
  computeRollingAverageAppointments,
  SETTER_RAMP_WEEK3_AVG_TARGET_DEFAULT,
  SETTER_RAMP_AVG_WINDOW_WEEKS_DEFAULT,
  SETTER_RAMP_WEEKLY_FLOOR_DEFAULT,
  SETTER_RAMP_PAYROLL_TZ,
} from '@/lib/setter-ramp-utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Enrollment = {
  id: string
  org_id: string
  user_id: string
  start_date: string
  status: 'active' | 'cancelled'
}

type WeeklyStatusRow = {
  id: string
  enrollment_id: string
  user_id: string
  week_number: number
  week_starts_at: string
  week_ends_at: string
  doors_knocked: number
  appointments_set: number
  rolling_avg_appointments: number | null
  gate_passed: boolean
  gate_passed_at: string | null
  commission_total: number | null
  floor_amount: number | null
  payout_source: 'floor' | 'commission' | null
  payroll_period_id: string | null
  bonus_registered: boolean
}

type LeadRow = {
  owner_user_id: string | null
  pin_attributed_user_id: string | null
  created_at: string
}

type AppointmentRow = {
  canvasser_user_id: string | null
  created_at: string
  appointment_type?: string | null
  status?: string | null
}

type PayrollPeriodRow = {
  id: string
  scheduled_pay_date: string
}

type OrgRampSettings = {
  weeklyFloorAmount: number
  week3AvgTarget: number
  avgWindowWeeks: number
}

export type GateSyncResult = { enrollmentsSynced: number; weeksSynced: number }
export type FloorBonusSyncResult = { evaluated: number; floorWins: number; commissionWins: number; held: number }

const DOOR_KNOCK_SOURCES = ['door_to_door', 'canvass', 'door_knock']

async function loadOrgRampSettings(admin: SupabaseClient, orgId: string): Promise<OrgRampSettings> {
  const { data, error } = await admin
    .from('orgs')
    .select('setter_ramp_weekly_floor_amount, setter_ramp_week3_avg_target, setter_ramp_avg_window_weeks')
    .eq('id', orgId)
    .single()

  if (error || !data) {
    throw new Error(`sync-setter-ramp: failed to load org settings: ${error?.message ?? 'org not found'}`)
  }

  return {
    weeklyFloorAmount:
      data.setter_ramp_weekly_floor_amount != null
        ? Number(data.setter_ramp_weekly_floor_amount)
        : SETTER_RAMP_WEEKLY_FLOOR_DEFAULT,
    week3AvgTarget:
      data.setter_ramp_week3_avg_target != null
        ? Number(data.setter_ramp_week3_avg_target)
        : SETTER_RAMP_WEEK3_AVG_TARGET_DEFAULT,
    avgWindowWeeks:
      data.setter_ramp_avg_window_weeks != null
        ? Number(data.setter_ramp_avg_window_weeks)
        : SETTER_RAMP_AVG_WINDOW_WEEKS_DEFAULT,
  }
}

function countInWindow<T extends { created_at: string }>(rows: T[], startsAt: string, endsAt: string): number {
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  return rows.filter((r) => {
    const ts = new Date(r.created_at).getTime()
    return ts >= start && ts < end // exclusive end
  }).length
}

// ── Stage 1: gate tracking (doors/appointments/rolling-avg/gate_passed) ──────
// Safe to run frequently (e.g. hourly) — reads live activity data and upserts
// weekly_status rows. Writes no money.
export async function syncOrgSetterRampGates(
  admin: SupabaseClient,
  orgId: string,
  options?: { userId?: string }
): Promise<GateSyncResult> {
  const settings = await loadOrgRampSettings(admin, orgId)
  const nowIso = new Date().toISOString()

  let enrollmentQuery = admin
    .from('setter_ramp_enrollments')
    .select('id, org_id, user_id, start_date, status')
    .eq('org_id', orgId)
    .eq('status', 'active')

  if (options?.userId) {
    enrollmentQuery = enrollmentQuery.eq('user_id', options.userId)
  }

  const { data: enrollmentRows, error: enrollmentError } = await enrollmentQuery
  if (enrollmentError) throw new Error(enrollmentError.message)

  const enrollments = (enrollmentRows ?? []) as Enrollment[]
  if (enrollments.length === 0) return { enrollmentsSynced: 0, weeksSynced: 0 }

  let weeksSynced = 0

  for (const enrollment of enrollments) {
    const startDate = new Date(`${enrollment.start_date}T12:00:00Z`)
    const currentWeek = tenureWeekNumberForDate(startDate, new Date(nowIso), SETTER_RAMP_PAYROLL_TZ)
    if (currentWeek == null) continue // program hasn't started yet for this enrollment

    const week1Window = computeSetterRampWeekWindow(startDate, 1, SETTER_RAMP_PAYROLL_TZ)
    const currentWeekWindow = computeSetterRampWeekWindow(startDate, currentWeek, SETTER_RAMP_PAYROLL_TZ)

    // Single range fetch spanning week 1 through the current week. Reads canvass_knocks
    // (202608250001_canvass_knocks.sql), not leads: a re-knock of a pre-existing pin
    // UPDATEs the lead row in place with no new created_at, so counting leads directly
    // missed it. user_id is already resolved at knock time (app/api/canvass/lead/route.ts):
    // the rep actually at the door for a field knock, falling back to the frozen pin
    // attribution (pin_attributed_user_id, then owner_user_id) for non-field callers —
    // it's mapped onto the LeadRow shape below rather than reshaping this function.
    const [leadsResult, appointmentsResult] = await Promise.all([
      admin
        .from('canvass_knocks')
        .select('user_id, created_at')
        .eq('org_id', orgId)
        .in('source', DOOR_KNOCK_SOURCES)
        .gte('created_at', week1Window.weekStartsAt)
        .lt('created_at', currentWeekWindow.weekEndsAt),
      admin
        .from('scheduled_appointments')
        .select('canvasser_user_id, created_at, appointment_type, status')
        .eq('org_id', orgId)
        .gte('created_at', week1Window.weekStartsAt)
        .lt('created_at', currentWeekWindow.weekEndsAt)
        .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)
        .neq('status', 'cancelled'),
    ])

    if (leadsResult.error) {
      console.error(`[sync-setter-ramp] leads fetch failed for ${enrollment.user_id}:`, leadsResult.error.message)
      continue
    }
    if (appointmentsResult.error) {
      console.error(
        `[sync-setter-ramp] appointments fetch failed for ${enrollment.user_id}:`,
        appointmentsResult.error.message
      )
      continue
    }

    const knockRows = (leadsResult.data ?? []) as CanvassKnockRow[]
    const userLeads: LeadRow[] = knocksAsAttributedLeadRows(knockRows).filter(
      (l) => getAttributedCanvassLeadUserId(l) === enrollment.user_id
    )
    const userAppointments = ((appointmentsResult.data ?? []) as AppointmentRow[]).filter(
      (a) => a.canvasser_user_id === enrollment.user_id && countsAsInspectionSet(a)
    )

    // Existing rows for this enrollment, so we only insert what's missing and
    // preserve payroll-side fields (payroll_period_id, bonus_registered, etc.)
    // on rows the floor-bonus stage has already touched.
    const { data: existingRows, error: existingError } = await admin
      .from('setter_ramp_weekly_status')
      .select('id, week_number, payroll_period_id, bonus_registered')
      .eq('enrollment_id', enrollment.id)

    if (existingError) {
      console.error(`[sync-setter-ramp] failed to load existing weeks for ${enrollment.id}:`, existingError.message)
      continue
    }

    const existingByWeek = new Map((existingRows ?? []).map((r) => [r.week_number as number, r]))

    // Appointments-per-week series from week 3 onward, needed for the rolling
    // average — computed once per enrollment, reused across weeks 3..current.
    const apptCountsFromWeek3: number[] = []

    for (let weekNumber = 1; weekNumber <= currentWeek; weekNumber += 1) {
      const window = computeSetterRampWeekWindow(startDate, weekNumber, SETTER_RAMP_PAYROLL_TZ)
      const doors = countInWindow(userLeads, window.weekStartsAt, window.weekEndsAt)
      const appointments = countInWindow(userAppointments, window.weekStartsAt, window.weekEndsAt)

      let rollingAvg: number | null = null
      if (weekNumber >= 3) {
        apptCountsFromWeek3.push(appointments)
        rollingAvg = computeRollingAverageAppointments(apptCountsFromWeek3, settings.avgWindowWeeks)
      }

      const gatePassed = evaluateRampGate({
        weekNumber,
        doorsKnocked: doors,
        appointmentsSet: appointments,
        rollingAvgAppointments: rollingAvg,
        week3AvgTarget: settings.week3AvgTarget,
      })

      const existing = existingByWeek.get(weekNumber)

      if (!existing) {
        const { error: insertError } = await admin.from('setter_ramp_weekly_status').insert({
          org_id: orgId,
          enrollment_id: enrollment.id,
          user_id: enrollment.user_id,
          week_number: weekNumber,
          week_starts_at: window.weekStartsAt,
          week_ends_at: window.weekEndsAt,
          doors_knocked: doors,
          appointments_set: appointments,
          rolling_avg_appointments: rollingAvg,
          gate_passed: gatePassed,
          gate_passed_at: gatePassed ? nowIso : null,
        })
        if (insertError && insertError.code !== '23505') {
          console.error(`[sync-setter-ramp] insert failed for week ${weekNumber}:`, insertError.message)
          continue
        }
        weeksSynced += 1
        continue
      }

      // Never downgrade a week that already registered a floor bonus — its
      // dollar fields are locked in once bonus_registered is true; only the
      // activity counts (which can't retroactively change a paid decision)
      // are safe to keep refreshing for display purposes.
      const update: Record<string, unknown> = {
        doors_knocked: doors,
        appointments_set: appointments,
        rolling_avg_appointments: rollingAvg,
      }
      if (!existing.bonus_registered) {
        update.gate_passed = gatePassed
        if (gatePassed) update.gate_passed_at = nowIso
      }

      const { error: updateError } = await admin
        .from('setter_ramp_weekly_status')
        .update(update)
        .eq('id', existing.id)
      if (updateError) {
        console.error(`[sync-setter-ramp] update failed for week ${weekNumber}:`, updateError.message)
        continue
      }
      weeksSynced += 1
    }
  }

  return { enrollmentsSynced: enrollments.length, weeksSynced }
}

// ── Stage 2: floor-vs-commission reconciliation (writes money) ───────────────
// KNOWN GAP — verify before trusting in production: payroll_payout_lines is
// populated by a "follow-up pass" run after a period is locked, per the lock
// endpoint's own response message (app/api/admin/payroll/periods/[periodId]/
// route.ts: "Job-level snapshots and payout lines are generated on a
// follow-up pass; use commission export until backfill runs"). This function
// sums payroll_payout_lines for participant_role='setter' — if that backfill
// hasn't run for a period yet, every setter's commission reads as $0 and the
// floor wins by default (a safe failure direction — nobody gets underpaid —
// but it means every setter looks like a $0-commission week until the
// backfill catches up). Confirm the backfill is reliably complete before a
// period reaches 'locked'/'paid', or gate this sync on that explicitly,
// before wiring it into a real cron.
async function getSetterPeriodCommissionTotal(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  payrollPeriodId: string
): Promise<number> {
  const { data, error } = await admin
    .from('payroll_payout_lines')
    .select('net_amount')
    .eq('org_id', orgId)
    .eq('payroll_period_id', payrollPeriodId)
    .eq('user_id', userId)
    .eq('participant_role', 'setter')

  if (error) throw new Error(error.message)
  return roundMoney((data ?? []).reduce((sum, row) => sum + (Number(row.net_amount) || 0), 0))
}

/**
 * For gate-passed weeks not yet reconciled against payroll, find the first
 * LOCKED or PAID period whose scheduled pay date covers the week's end (same
 * "earliest matching payday" rule as pickPayrollPeriodForWeekEnd above, just
 * run against locked periods instead of open ones — see the gap above for
 * why it has to wait for locked, not open, periods). Writes a
 * 'setter_weekly_floor' payroll_bonus_lines row (status pending_approval,
 * routes through the existing Bonus Approval UI — no new approval UI needed)
 * only when the floor beats that period's actual 3% commission.
 */
export async function syncSetterFloorBonuses(
  admin: SupabaseClient,
  orgId: string,
  callerUserId: string | null
): Promise<FloorBonusSyncResult> {
  const settings = await loadOrgRampSettings(admin, orgId)

  const { data: candidateRows, error: candidateError } = await admin
    .from('setter_ramp_weekly_status')
    .select(
      'id, enrollment_id, user_id, week_number, week_starts_at, week_ends_at, doors_knocked, appointments_set, rolling_avg_appointments, gate_passed, gate_passed_at, commission_total, floor_amount, payout_source, payroll_period_id, bonus_registered'
    )
    .eq('org_id', orgId)
    .eq('gate_passed', true)
    .eq('bonus_registered', false)

  if (candidateError) throw new Error(candidateError.message)
  const candidates = (candidateRows ?? []) as WeeklyStatusRow[]
  if (candidates.length === 0) return { evaluated: 0, floorWins: 0, commissionWins: 0, held: 0 }

  const { data: periodRows, error: periodError } = await admin
    .from('payroll_periods')
    .select('id, scheduled_pay_date')
    .eq('org_id', orgId)
    .in('status', ['locked', 'paid'])

  if (periodError) throw new Error(periodError.message)
  const lockedPeriods = (periodRows ?? []) as PayrollPeriodRow[]

  let floorWins = 0
  let commissionWins = 0
  let held = 0

  for (const row of candidates) {
    const targetPeriodId = pickPayrollPeriodForWeekEnd(lockedPeriods, row.week_ends_at, SETTER_RAMP_PAYROLL_TZ)
    if (!targetPeriodId) {
      held += 1
      continue // no locked period covers this week yet — retry on a later run
    }

    const commissionTotal = await getSetterPeriodCommissionTotal(admin, orgId, row.user_id, targetPeriodId)
    const floorAmount = settings.weeklyFloorAmount
    const payoutSource: 'floor' | 'commission' = commissionTotal >= floorAmount ? 'commission' : 'floor'

    const updatePayload: Record<string, unknown> = {
      commission_total: commissionTotal,
      floor_amount: floorAmount,
      payout_source: payoutSource,
      payroll_period_id: targetPeriodId,
      bonus_registered: true,
    }

    if (payoutSource === 'commission') {
      commissionWins += 1
      const { error: updateError } = await admin.from('setter_ramp_weekly_status').update(updatePayload).eq('id', row.id)
      if (updateError) {
        console.error(`[sync-setter-ramp] failed to record commission-wins week ${row.id}:`, updateError.message)
      }
      continue
    }

    floorWins += 1
    const topUpAmount = roundMoney(floorAmount - commissionTotal)

    const { error: bonusError } = await admin.from('payroll_bonus_lines').insert({
      org_id: orgId,
      payroll_period_id: targetPeriodId,
      user_id: row.user_id,
      bonus_type: 'setter_weekly_floor',
      amount: topUpAmount,
      description: `Setter weekly floor top-up (week ${row.week_number}: $${floorAmount} floor vs $${commissionTotal} commission)`,
      source_id: row.id,
      created_by: callerUserId,
      status: 'pending_approval',
    })

    if (bonusError && bonusError.code !== '23505') {
      console.error(`[sync-setter-ramp] failed to insert floor bonus for week ${row.id}:`, bonusError.message)
      // Don't mark bonus_registered — retry on next run.
      continue
    }

    const { error: updateError } = await admin.from('setter_ramp_weekly_status').update(updatePayload).eq('id', row.id)
    if (updateError) {
      console.error(`[sync-setter-ramp] failed to update week ${row.id} after bonus insert:`, updateError.message)
    }

    const { error: notifError } = await admin.from('notifications').insert({
      org_id: orgId,
      recipient_user_id: row.user_id,
      actor_user_id: callerUserId,
      type: 'setter_ramp_floor_bonus',
      title: 'Weekly floor pay applied',
      body: `Your week ${row.week_number} pay used the $${floorAmount} performance floor (commission was $${commissionTotal}). Pending payroll approval.`,
    })
    if (notifError) {
      console.error(`[sync-setter-ramp] failed to insert notification for week ${row.id}:`, notifError.message)
    }
  }

  return { evaluated: candidates.length, floorWins, commissionWins, held }
}
