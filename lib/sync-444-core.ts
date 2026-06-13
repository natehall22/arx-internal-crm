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
  scheduled_pay_date: string
}

export type QualifiedResult = {
  user_id: string
  week: 1 | 2
}

// Minimal shape needed to count progress for an enrollment. Both the full
// Enrollment row (sync) and the GET handler's display rows satisfy this.
export type CountableEnrollment = {
  id: string
  user_id: string
  week1_starts_at: string
  week1_ends_at: string
  week2_starts_at: string
  week2_ends_at: string
}

export type EnrollmentCounts = {
  week1_doors: number
  week1_inspections: number
  week2_doors: number
  week2_inspections: number
}

export type SyncOrgResult = {
  synced: number
  qualified: QualifiedResult[]
}

const DOOR_KNOCK_SOURCES = ['door_to_door', 'canvass', 'door_knock']

// 444 program qualification thresholds — shared constants so they're easy to find and change
export const PROGRAM_444_DOOR_THRESHOLD = 400
export const PROGRAM_444_INSPECTION_THRESHOLD = 4

export const PROGRAM_444_PAYROLL_TZ = 'America/New_York'

// Calendar date (YYYY-MM-DD) of an instant in the payroll timezone. Used to compare
// a 444 week boundary against payroll_periods.scheduled_pay_date (a DATE).
export function payrollZoneDate(iso: string, timezone = PROGRAM_444_PAYROLL_TZ): string {
  // en-CA formats as YYYY-MM-DD, which sorts/compares correctly as a string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

// Pick the payroll period a 444 week's bonus should pay in: the EARLIEST open
// period whose scheduled pay date falls on/after the week's (exclusive) end —
// i.e. the payday following the work week. Returns null when no such period
// exists yet, in which case the caller HOLDS the bonus (no line) and a later
// sync attaches it once the right period is created. `openPeriods` must contain
// only attachable (status='open') periods; order does not matter.
export function pickPayrollPeriodForWeekEnd(
  openPeriods: PayrollPeriodRow[],
  weekEndsAtIso: string,
  timezone = PROGRAM_444_PAYROLL_TZ,
): string | null {
  const weekEndDate = payrollZoneDate(weekEndsAtIso, timezone)
  let best: PayrollPeriodRow | null = null
  for (const p of openPeriods) {
    if (!p.scheduled_pay_date) continue
    if (p.scheduled_pay_date < weekEndDate) continue // pays before the week closes — too early
    if (best === null || p.scheduled_pay_date < best.scheduled_pay_date) best = p
  }
  return best?.id ?? null
}

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

// ── Pure counting core (no I/O, no side effects) ───────────────────────────────
// Given already-fetched door-knock leads + appointments, compute each
// enrollment's week1/week2 door and inspection counts. This is the EXACT logic
// the sync uses to derive counts — extracted verbatim so the live display and
// the persisted sync can never diverge. It performs NO writes and reads no DB.
export function computeEnrollmentCounts(
  enrollments: CountableEnrollment[],
  leads: LeadRow[],
  appointments: AppointmentRow[],
): Map<string, EnrollmentCounts> {
  // Attribution mirrors the rep dashboard: pin_attributed_user_id wins over
  // owner_user_id (via getAttributedCanvassLeadUserId).
  const leadsByUser = new Map<string, LeadRow[]>()
  for (const l of leads) {
    const userId = getAttributedCanvassLeadUserId(l)
    if (!userId) continue
    const arr = leadsByUser.get(userId) ?? []
    arr.push(l)
    leadsByUser.set(userId, arr)
  }

  const appointmentsByUser = new Map<string, AppointmentRow[]>()
  for (const a of appointments) {
    if (!a.canvasser_user_id) continue
    const arr = appointmentsByUser.get(a.canvasser_user_id) ?? []
    arr.push(a)
    appointmentsByUser.set(a.canvasser_user_id, arr)
  }

  const counts = new Map<string, EnrollmentCounts>()
  for (const e of enrollments) {
    counts.set(e.id, {
      week1_doors: countLeads(leadsByUser, e.user_id, e.week1_starts_at, e.week1_ends_at),
      week1_inspections: countAppointments(appointmentsByUser, e.user_id, e.week1_starts_at, e.week1_ends_at),
      week2_doors: countLeads(leadsByUser, e.user_id, e.week2_starts_at, e.week2_ends_at),
      week2_inspections: countAppointments(appointmentsByUser, e.user_id, e.week2_starts_at, e.week2_ends_at),
    })
  }
  return counts
}

// ── Read-only fetch + count (no writes) ────────────────────────────────────────
// Fetches the door-knock leads + appointments spanning all supplied enrollments'
// windows and returns live counts. Safe to call from the GET handler: it never
// inserts bonus lines, notifications, or flips qualified flags.
export async function fetchEnrollmentCounts(
  admin: SupabaseClient,
  orgId: string,
  enrollments: CountableEnrollment[],
): Promise<Map<string, EnrollmentCounts>> {
  if (enrollments.length === 0) return new Map()

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

  return computeEnrollmentCounts(
    enrollments,
    (leadsResult.data ?? []) as LeadRow[],
    (appointmentsResult.data ?? []) as AppointmentRow[],
  )
}

export async function syncOrgEnrollments(
  admin: SupabaseClient,
  orgId: string,
  callerUserId: string | null,
  // When userId is provided, only that rep's active enrollment(s) are processed.
  // Everything downstream (counting, qualification flip, bonus line, notification,
  // optimistic lock) operates strictly on the fetched enrollments, so narrowing the
  // fetch is a complete and safe scoping — used by the rep-triggered /api/sisu/sync
  // so a rep can finalize their OWN 444 without depending on the org-wide cron.
  options?: { userId?: string },
): Promise<SyncOrgResult> {
  const nowIso = new Date().toISOString()

  // ── Fetch org settings + active enrollments in parallel ──────────────────
  let enrollmentQuery = admin
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
    .eq('status', 'active')

  if (options?.userId) {
    enrollmentQuery = enrollmentQuery.eq('user_id', options.userId)
  }

  const [orgResult, enrollmentResult] = await Promise.all([
    admin
      .from('orgs')
      .select('program_444_week_bonus_amount, program_444_week_bonus_label')
      .eq('id', orgId)
      .single(),
    enrollmentQuery,
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

  // Counts are derived by the shared, side-effect-free counter so the live
  // display (GET handler) and the persisted sync can never disagree.
  const countsById = await fetchEnrollmentCounts(admin, orgId, enrollments)

  // All attachable (open) periods. A 444 week's bonus pays in the period whose
  // pay date follows the work week (pickPayrollPeriodForWeekEnd). When none exists
  // yet, the bonus is HELD and a later sync attaches it once the period is created.
  let openPeriods: PayrollPeriodRow[] = []
  const { data: periodRows, error: periodError } = await admin
    .from('payroll_periods')
    .select('id, scheduled_pay_date')
    .eq('org_id', orgId)
    .eq('status', 'open')

  if (periodError) {
    console.warn('[sync-444] Could not fetch open payroll periods:', periodError.message)
  } else {
    openPeriods = (periodRows ?? []) as PayrollPeriodRow[]
  }

  if (openPeriods.length === 0) {
    console.warn('[sync-444] No open payroll period for org', orgId, '— bonuses will be held until one exists')
  }

  // Register (or attach) a single week's bonus line, idempotently. Returns:
  //  'registered' — line exists/created in the correct period and the enrollment
  //                 is stamped with that period id;
  //  'held'       — no matching period exists yet, nothing written (retry later);
  //  'error'      — a write failed (already logged).
  // The DB unique index (payroll_period_id,user_id,bonus_type,source_id) makes the
  // insert idempotent; the `.is(col,null)` guard never MOVES an existing attachment.
  async function registerWeekBonus(
    enrollment: Enrollment,
    week: 1 | 2,
    weekEndsAt: string,
  ): Promise<'registered' | 'held' | 'error'> {
    const targetPeriodId = pickPayrollPeriodForWeekEnd(openPeriods, weekEndsAt)
    if (!targetPeriodId) return 'held'

    const bonusType = week === 1 ? '444_week1' : '444_week2'
    const periodCol = week === 1 ? 'week1_payroll_period_id' : 'week2_payroll_period_id'

    const { error: bonusError } = await admin.from('payroll_bonus_lines').insert({
      org_id: orgId,
      payroll_period_id: targetPeriodId,
      user_id: enrollment.user_id,
      bonus_type: bonusType,
      amount: weekBonusAmount,
      description: `ARX 444 Program Week ${week} Bonus`,
      source_id: enrollment.id,
      created_by: callerUserId,
      status: 'pending_approval',
    })
    if (bonusError && bonusError.code !== '23505') {
      console.error(`[sync-444] Failed to insert week${week} bonus line:`, bonusError.message)
      return 'error'
    }

    const { error: attachError } = await admin
      .from('program_444_enrollments')
      .update({ [periodCol]: targetPeriodId })
      .eq('id', enrollment.id)
      .is(periodCol, null) // only set when still unattached — never move an existing attachment
    if (attachError) {
      console.error(`[sync-444] Failed to stamp week${week} payroll period:`, attachError.message)
    }
    return 'registered'
  }

  // One qualification notification per newly-flipped week (winner of the lock).
  async function notifyWeekQualified(
    userId: string,
    week: 1 | 2,
    registration: 'registered' | 'held' | 'error',
  ): Promise<void> {
    const wk = `Week ${week}`
    const body =
      registration === 'registered'
        ? `You qualified for the ${weekBonusLabel} ${wk} bonus. It has been registered for payroll.`
        : registration === 'held'
        ? `You qualified for ${wk}! Your ${weekBonusLabel} bonus will be registered when the matching payroll period opens.`
        : `You qualified for ${wk}! Bonus registration hit an issue — contact your manager.`

    const { error: notifError } = await admin.from('notifications').insert({
      org_id: orgId,
      recipient_user_id: userId,
      actor_user_id: callerUserId,
      type: 'sisu_444_qualified',
      title: 'You hit the 444!',
      body,
    })
    if (notifError) {
      console.error(`[sync-444] Failed to insert week${week} notification:`, notifError.message)
    }
  }

  const qualified: QualifiedResult[] = []
  let synced = 0

  for (const enrollment of enrollments) {
    const counts = countsById.get(enrollment.id) ?? {
      week1_doors: 0,
      week1_inspections: 0,
      week2_doors: 0,
      week2_inspections: 0,
    }

    const week1NowQualified =
      counts.week1_doors >= PROGRAM_444_DOOR_THRESHOLD && counts.week1_inspections >= PROGRAM_444_INSPECTION_THRESHOLD
    const week2NowQualified =
      counts.week2_doors >= PROGRAM_444_DOOR_THRESHOLD && counts.week2_inspections >= PROGRAM_444_INSPECTION_THRESHOLD

    const week1NewlyQualified = !enrollment.week1_qualified && week1NowQualified
    const week2NewlyQualified = !enrollment.week2_qualified && week2NowQualified

    // Count refresh + qualified-flag flips ONLY. Bonus attachment and the
    // 'completed' status happen afterward — a HELD bonus (no matching period yet)
    // must not mark the enrollment completed, or later syncs (which fetch only
    // active enrollments) would never come back to attach it.
    const enrollmentUpdate: Record<string, unknown> = {
      week1_doors: counts.week1_doors,
      week1_inspections: counts.week1_inspections,
      week2_doors: counts.week2_doors,
      week2_inspections: counts.week2_inspections,
    }
    if (week1NewlyQualified) {
      enrollmentUpdate.week1_qualified = true
      enrollmentUpdate.week1_qualified_at = nowIso
    }
    if (week2NewlyQualified) {
      enrollmentUpdate.week2_qualified = true
      enrollmentUpdate.week2_qualified_at = nowIso
    }

    // ── Optimistic lock (race condition) ──────────────────────────────────────
    // If a concurrent sync already flipped a flag we're flipping, 0 rows update
    // and that week's bonus/notification is owned by the other sync.
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
        ? baseQuery.eq('week2_qualified', false).eq('week1_qualified', enrollment.week1_qualified)
        : baseQuery

    const { data: updatedRows, error: updateError } = await lockedQuery.select('id')

    if (updateError) {
      console.error(`[sync-444] Failed to update enrollment ${enrollment.id}:`, updateError.message)
      continue
    }

    synced += 1
    const didUpdate = (updatedRows?.length ?? 0) > 0

    // Effective qualified state after this sync's flip. A newly-qualified flag
    // only counts if THIS sync won the lock; otherwise the concurrent winner
    // owns that week's bonus + notification and we must not double-handle it.
    const week1Qualified = enrollment.week1_qualified || (week1NewlyQualified && didUpdate)
    const week2Qualified = enrollment.week2_qualified || (week2NewlyQualified && didUpdate)

    // ── Bonus registration / attachment (decoupled from qualification) ────────
    // Attempt for any qualified week not yet attached to a period — both on the
    // qualifying sync AND on a later sync that finally finds a matching period
    // (the HELD case). Idempotent via the unique index + `.is(col,null)` guard.
    let week1Reg: 'registered' | 'held' | 'error' = 'held'
    if (week1Qualified && enrollment.week1_payroll_period_id == null) {
      week1Reg = await registerWeekBonus(enrollment, 1, enrollment.week1_ends_at)
    }
    let week2Reg: 'registered' | 'held' | 'error' = 'held'
    if (week2Qualified && enrollment.week2_payroll_period_id == null) {
      week2Reg = await registerWeekBonus(enrollment, 2, enrollment.week2_ends_at)
    }

    // Notify once, on the sync that actually flips the flag (the lock winner).
    if (week1NewlyQualified && didUpdate) {
      qualified.push({ user_id: enrollment.user_id, week: 1 })
      await notifyWeekQualified(enrollment.user_id, 1, week1Reg)
    }
    if (week2NewlyQualified && didUpdate) {
      qualified.push({ user_id: enrollment.user_id, week: 2 })
      await notifyWeekQualified(enrollment.user_id, 2, week2Reg)
    }

    // Mark completed only when BOTH weeks are qualified AND their bonuses are
    // attached to a period. A held week keeps the enrollment active so a future
    // sync can attach it (active is the only status this function fetches).
    const week1Attached = enrollment.week1_payroll_period_id != null || week1Reg === 'registered'
    const week2Attached = enrollment.week2_payroll_period_id != null || week2Reg === 'registered'
    if (enrollment.status === 'active' && week1Qualified && week2Qualified && week1Attached && week2Attached) {
      const { error: completeError } = await admin
        .from('program_444_enrollments')
        .update({ status: 'completed' })
        .eq('id', enrollment.id)
        .eq('status', 'active')
      if (completeError) {
        console.error(`[sync-444] Failed to mark enrollment ${enrollment.id} completed:`, completeError.message)
      }
    }
  }

  return { synced, qualified }
}
