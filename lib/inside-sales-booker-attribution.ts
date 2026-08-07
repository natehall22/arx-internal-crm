/**
 * Works out which inside-sales rep put an insurance appointment back on the
 * calendar, so they can earn a per-unit sit credit for it.
 *
 * Why this exists: a stalled insurance deal gets handed to the inside-sales queue.
 * The rep there calls the customer and re-books the insurance appointment. Until
 * now the only "who booked this" fields were:
 *
 *   - `opportunities.setter_user_id` — the setter who knocked the door. Sit pay
 *     keys off this (lib/comp-plan-period-unit-earnings.ts), so the setter earns
 *     the sit and the inside-sales rep earns nothing.
 *   - `scheduled_appointments.canvasser_user_id` — copied from the ORIGINAL
 *     appointment when inside sales re-books, so it is the setter too.
 *   - `scheduled_appointments.closer_user_id` — who runs the appointment.
 *
 * `inside_sales_booked_by_user_id` is the missing fourth fact. Setter attribution
 * is deliberately untouched: the setter keeps setter credit and setter commission.
 *
 * This credit is ADDITIVE, not a reattribution. It is keyed on a different
 * real-world event (an inside-sales re-book that then happened) from the sit unit
 * the setter earns (the original door-knocked inspection). See
 * `loadInsideSalesSitCreditsForUser` for the anti-double-pay rules.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'

/**
 * Appointment types an inside-sales rep can put on the calendar and be credited for.
 *
 * `adjuster_meeting` — the physical, in-person adjuster meeting. The inside rep
 * books it; the ATTENDING field rep certifies it happened by completing it
 * (lib/adjuster-meeting.ts). Booker and certifier are different people, which is
 * what makes this credit safe.
 *
 * `insurance_call` — the inside rep's own phone call. Still creditable because the
 * owner confirmed paying it, but note the booker also completes these through their
 * own log_call flow, so it does NOT have the separation adjuster_meeting has.
 *
 * `insurance_follow_up` is deliberately EXCLUDED. Those rows are created by the
 * closer-booked feedback flow at the inspection, not by inside sales — crediting
 * them would pay the inside rep for bookings they did not make. (In practice
 * nothing stamps a booker on them, so they would not pay anyway; excluding them
 * makes that intent explicit rather than incidental.)
 */
export const INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPES = [
  'insurance_call',
  'adjuster_meeting',
] as const

/** PostgREST `.in()` argument matching the types above. */
export const INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPE_LIST: string[] = [
  ...INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPES,
]

export type InsideSalesBookedAppointmentRow = {
  id: string
  opportunity_id?: string | null
  lead_id?: string | null
  appointment_type?: string | null
  status?: string | null
  scheduled_for?: string | null
  inside_sales_booked_by_user_id?: string | null
  inside_sales_sit_credit_excluded?: boolean | null
}

export type InsideSalesSitCredit = {
  appointmentId: string
  userId: string
  opportunityId: string | null
  leadId: string | null
  /** The appointment's scheduled_for — the date the credit lands in payroll. */
  eventAt: string
}

export type InsideSalesSitCreditConfig = {
  enabled: boolean
  /** ISO date (YYYY-MM-DD). Null means no credit is payable. */
  effectiveFrom: string | null
}

export const INSIDE_SALES_SIT_CREDIT_DISABLED: InsideSalesSitCreditConfig = {
  enabled: false,
  effectiveFrom: null,
}

/**
 * Read the org gate. Both the switch AND a cutoff date are required — enabling
 * without a date pays nothing.
 *
 * Period unit pay is recomputed live from the database on every statement render
 * (it is not snapshotted into payout lines), so a credit with no cutoff would
 * retroactively change already-locked and already-paid periods. The date is the
 * guard against that, which is why a missing one means "off" rather than "always".
 */
export function resolveInsideSalesSitCreditConfig(
  orgRow:
    | {
        inside_sales_sit_credit_enabled?: boolean | null
        inside_sales_sit_credit_effective_from?: string | null
      }
    | null
    | undefined
): InsideSalesSitCreditConfig {
  if (!orgRow) return INSIDE_SALES_SIT_CREDIT_DISABLED
  if (orgRow.inside_sales_sit_credit_enabled !== true) return INSIDE_SALES_SIT_CREDIT_DISABLED

  const raw = orgRow.inside_sales_sit_credit_effective_from
  if (typeof raw !== 'string' || !raw.trim()) return INSIDE_SALES_SIT_CREDIT_DISABLED
  const effectiveFrom = raw.trim().slice(0, 10)
  if (!Number.isFinite(new Date(`${effectiveFrom}T00:00:00Z`).getTime())) {
    return INSIDE_SALES_SIT_CREDIT_DISABLED
  }

  return { enabled: true, effectiveFrom }
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * True when this appointment row is an inside-sales re-book that actually
 * happened, and is therefore payable.
 *
 * Requires `status === 'completed'`. Booking alone must not pay — the customer has
 * to have kept the appointment, same as a sit means the rep actually sat.
 */
export function countsAsInsideSalesSitCredit(
  row: InsideSalesBookedAppointmentRow,
  effectiveFrom: string | null
): boolean {
  if (!row.inside_sales_booked_by_user_id) return false
  if (row.inside_sales_sit_credit_excluded === true) return false

  const type = (row.appointment_type ?? '').trim().toLowerCase()
  if (!INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPE_LIST.includes(type)) return false

  const status = (row.status ?? '').trim().toLowerCase()
  if (status !== 'completed') return false

  const at = parseTime(row.scheduled_for)
  if (at === null) return false

  if (!effectiveFrom) return false
  const eventDateEastern = formatInTimeZone(new Date(at), 'America/New_York', 'yyyy-MM-dd')
  if (eventDateEastern < effectiveFrom) return false

  return true
}

/**
 * Reduce raw appointment rows to at most ONE credit per opportunity,
 * choosing the EARLIEST qualifying appointment.
 *
 * This mirrors the `first_qualifying` rule payroll already uses for setter sits
 * (lib/dashboard-sit-metrics.ts). Without it, an insurance deal that gets
 * re-booked five times would pay the same rep five sit units. With it, a
 * re-book loop can never farm extra credits, and the pay period a credit lands
 * in never shifts once earned.
 *
 * Rows with no opportunity_id fall back to the lead, then to the appointment
 * itself, so an orphaned booking still pays exactly once.
 *
 * Ties on identical timestamps break by appointment id so the same row wins on
 * every run regardless of input order.
 */
export function pickFirstQualifyingInsideSalesCredits(
  rows: InsideSalesBookedAppointmentRow[],
  effectiveFrom: string | null
): InsideSalesSitCredit[] {
  const best = new Map<string, InsideSalesSitCredit & { t: number }>()

  for (const row of rows) {
    if (!countsAsInsideSalesSitCredit(row, effectiveFrom)) continue
    const userId = String(row.inside_sales_booked_by_user_id)
    const opportunityId = row.opportunity_id ? String(row.opportunity_id) : null
    const leadId = row.lead_id ? String(row.lead_id) : null
    const t = parseTime(row.scheduled_for)
    if (t === null) continue

    const scopeKey = opportunityId
      ? `opp:${opportunityId}`
      : leadId
        ? `lead:${leadId}`
        : `appt:${row.id}`
    const key = scopeKey

    const candidate = {
      appointmentId: String(row.id),
      userId,
      opportunityId,
      leadId,
      eventAt: String(row.scheduled_for),
      t,
    }

    const current = best.get(key)
    if (
      !current ||
      candidate.t < current.t ||
      (candidate.t === current.t && candidate.appointmentId < current.appointmentId)
    ) {
      best.set(key, candidate)
    }
  }

  return Array.from(best.values())
    .sort((a, b) => a.t - b.t || (a.appointmentId < b.appointmentId ? -1 : 1))
    .map(({ t: _t, ...credit }) => credit)
}

/** Keep only credits whose event lands inside [startIso, endIso). */
export function filterInsideSalesCreditsToPeriod(
  credits: InsideSalesSitCredit[],
  startIso: string,
  endIso: string
): InsideSalesSitCredit[] {
  const s = parseTime(startIso)
  const e = parseTime(endIso)
  if (s === null || e === null) return []
  return credits.filter((c) => {
    const t = parseTime(c.eventAt)
    return t !== null && t >= s && t < e
  })
}

/**
 * Load this user's inside-sales sit credits for a payroll period.
 *
 * Deliberately queries the org's FULL history rather than just one user or period
 * window: the earliest-qualifying dedupe above is only correct if it can see
 * earlier appointments on the same opportunity. A window-scoped query would
 * re-pay a credit already earned in a previous period.
 *
 * Throws on query error. An error swallowed into an empty list would silently
 * drop real pay, which is the same fail-closed rule loadInspectorByOpportunity
 * follows.
 */
export async function loadInsideSalesSitCreditsForUser(
  supabase: SupabaseClient,
  opts: {
    orgId: string
    userId: string
    startIso: string
    endIso: string
    config: InsideSalesSitCreditConfig
  }
): Promise<InsideSalesSitCredit[]> {
  const { orgId, userId, startIso, endIso, config } = opts
  if (!config.enabled || !config.effectiveFrom) return []

  const { data, error } = await supabase
    .from('scheduled_appointments')
    .select(
      'id, opportunity_id, lead_id, appointment_type, status, scheduled_for, inside_sales_booked_by_user_id, inside_sales_sit_credit_excluded'
    )
    .eq('org_id', orgId)
    .in('appointment_type', INSIDE_SALES_SIT_CREDIT_APPOINTMENT_TYPE_LIST)
    .order('scheduled_for', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error

  const credits = pickFirstQualifyingInsideSalesCredits(
    (data || []) as InsideSalesBookedAppointmentRow[],
    config.effectiveFrom
  )
  return filterInsideSalesCreditsToPeriod(
    credits.filter((credit) => credit.userId === userId),
    startIso,
    endIso
  )
}

/**
 * Drop any booker credit for an opportunity where this same user already earned a
 * setter sit unit in this period.
 *
 * The two credits are genuinely different events, but one person collecting two
 * sit units on one opportunity reads as a double-pay to whoever approves payroll.
 * The inside-sales rep is the setter on some of their own opportunities, so this
 * is a real case, not a theoretical one. Suppressing is the fail-closed choice.
 */
export function excludeCreditsAlreadyPaidAsSetterSit(
  credits: InsideSalesSitCredit[],
  setterSitOpportunityIds: Iterable<string>
): InsideSalesSitCredit[] {
  const taken = new Set(setterSitOpportunityIds)
  if (taken.size === 0) return credits
  return credits.filter((c) => !c.opportunityId || !taken.has(c.opportunityId))
}
