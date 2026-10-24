import type { SupabaseClient } from '@supabase/supabase-js'

import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'
import { loadActiveCompPlanForUser } from '@/lib/payroll-export'
import { resolveHourlyRate } from '@/lib/payroll-hourly-rate'
import { isPeriodClaimedError, PERIOD_CLAIMED_MESSAGE } from '@/lib/payroll-periods'
import { cutoffYmdEt, ymdEt } from '@/lib/weekly-payroll/cutoff'
import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'

export type HoursEntry = {
  user_id: string
  regular_hours: number
  overtime_hours: number
  notes?: string | null
  reason?: string | null
}

export type HourlyRosterRow = {
  user_id: string
  full_name: string
  role: string
  plan_name: string | null
  plan_type: string | null
  hourly_rate: number | null
  regular_hours: number
  overtime_hours: number
  hourly_earnings: number
  notes: string | null
  /** True once somebody has saved hours for this person this period (even 0). */
  has_entry: boolean
}

function isHourlyEligiblePlan(
  plan: (CompPlanForCalc & { hourly_rate?: number | null }) | null | undefined,
  hourlyRateOverride: number | null | undefined
): boolean {
  const pt = String(plan?.plan_type || '').toLowerCase()
  if (pt === 'hourly' || pt === 'hybrid') return true
  if (resolveHourlyRate({ hourlyRateOverride, compPlan: plan }) != null) return true
  return false
}

/** The Eastern calendar days a weekly period pays: [weekStart, weekEnd], weekEnd being the cutoff's own Eastern date. */
export function payWeekDays(cutoffAt: string | null | undefined): { start: string; end: string; days: string[] } {
  const cutoff = cutoffAt ? new Date(cutoffAt) : new Date()
  const end = cutoffYmdEt(cutoff)
  const days: string[] = []
  for (let i = 0; i < 7; i++) days.push(ymdEt(new Date(cutoff.getTime() - i * 86_400_000)))
  return { start: days[days.length - 1], end, days }
}

export type WeekPerson = { id: string; full_name: string; role: string; active: boolean }

/**
 * Everyone who could be owed pay for this week: active now, active on ANY day of the week (a plan assignment that
 * overlaps it — deactivation ends the assignment, so someone who left on Monday is still here), or with hours already
 * saved. The roster must not depend on who happens to be active at the moment Approve runs.
 */
export async function loadWeekPeople(supabase: SupabaseClient, orgId: string, period: { id: string; cutoff_at: string | null }): Promise<WeekPerson[]> {
  const { start, end } = payWeekDays(period.cutoff_at)
  const [{ data: activeUsers }, { data: savedRows }, { data: overlapping }] = await Promise.all([
    supabase.from('users').select('id, full_name, role, active').eq('org_id', orgId).eq('active', true).order('full_name'),
    supabase.from('payroll_rep_hours').select('user_id').eq('org_id', orgId).eq('payroll_period_id', period.id),
    supabase.from('user_comp_plans').select('user_id').eq('org_id', orgId).lte('effective_from', end).or(`effective_to.is.null,effective_to.gte.${start}`),
  ])
  const people = new Map<string, WeekPerson>()
  for (const u of activeUsers || []) people.set(u.id as string, { id: u.id as string, full_name: (u.full_name as string) || (u.id as string), role: u.role as string, active: true })
  const extra = Array.from(new Set([...(savedRows || []).map((r) => r.user_id as string), ...(overlapping || []).map((r) => r.user_id as string)])).filter((id) => !people.has(id))
  if (extra.length) {
    const { data: others } = await supabase.from('users').select('id, full_name, role, active').eq('org_id', orgId).in('id', extra)
    for (const u of others || []) people.set(u.id as string, { id: u.id as string, full_name: (u.full_name as string) || (u.id as string), role: u.role as string, active: u.active !== false })
  }
  return Array.from(people.values()).sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/**
 * The plan a person is paid under for this week: the one in force on the cutoff's Eastern date, or — for someone who left
 * during the week — the one in force on their last day (walking back day by day).
 */
export async function loadPlanForWeek(supabase: SupabaseClient, userId: string, orgId: string, cutoffAt: string | null | undefined, opts: { leftOrSaved: boolean }) {
  const { days } = payWeekDays(cutoffAt)
  const first = await loadActiveCompPlanForUser(supabase, userId, orgId, days[0])
  if (first || !opts.leftOrSaved) return first
  for (const day of days.slice(1)) {
    const a = await loadActiveCompPlanForUser(supabase, userId, orgId, day)
    if (a) return a
  }
  return null
}

/** Everyone who is paid by the hour this period, with their saved hours. The one hours read ("Pay this week" + the hours API). */
export async function loadHourlyRoster(
  supabase: SupabaseClient,
  orgId: string,
  period: { id: string; cutoff_at: string | null }
): Promise<HourlyRosterRow[]> {
  const [people, { data: savedRows }] = await Promise.all([
    loadWeekPeople(supabase, orgId, period),
    supabase
      .from('payroll_rep_hours')
      .select('user_id, regular_hours, overtime_hours, hourly_rate_snapshot, hourly_earnings, notes, locked_at')
      .eq('payroll_period_id', period.id)
      .eq('org_id', orgId),
  ])
  const savedByUser = new Map((savedRows || []).map((r) => [r.user_id as string, r]))

  const rows: HourlyRosterRow[] = []
  for (const u of people) {
    const saved = savedByUser.get(u.id)
    const assignment = await loadPlanForWeek(supabase, u.id, orgId, period.cutoff_at, { leftOrSaved: !u.active || Boolean(saved) })
    const plan = assignment?.comp_plans as (CompPlanForCalc & { hourly_rate?: number | null; name?: string | null }) | null
    // Saved hours always show (money already typed in is never hidden by a plan change); otherwise only hourly-eligible plans.
    if (!saved && !isHourlyEligiblePlan(plan, assignment?.hourly_rate_override)) continue

    const hourlyRate = resolveHourlyRate({ hourlyRateOverride: assignment?.hourly_rate_override, compPlan: plan })
    const reg = Number(saved?.regular_hours) || 0
    const ot = Number(saved?.overtime_hours) || 0
    const rate = hourlyRate ?? (Number(saved?.hourly_rate_snapshot) || 0)
    const earnings =
      saved?.hourly_earnings != null
        ? Number(saved.hourly_earnings)
        : computeHourlyEarnings({ regularHours: reg, overtimeHours: ot, hourlyRate: rate }).total
    rows.push({
      user_id: u.id,
      full_name: u.full_name,
      role: u.role,
      plan_name: plan?.name ?? null,
      plan_type: plan?.plan_type ?? null,
      hourly_rate: rate,
      regular_hours: reg,
      overtime_hours: ot,
      hourly_earnings: earnings,
      notes: (saved?.notes as string) ?? null,
      has_entry: Boolean(saved),
    })
  }
  return rows
}

export type SaveHoursResult = { ok: true; saved: Array<{ user_id: string; id: string }> } | { ok: false; status: number; error: string }

/** Saves hours (with an audit row per changed field). The one hours write. The caller has already checked the period is open. */
export async function saveHoursEntries(
  supabase: SupabaseClient,
  input: { orgId: string; periodId: string; cutoffAt: string | null; actorUserId: string; entries: HoursEntry[] }
): Promise<SaveHoursResult> {
  const { orgId, periodId, actorUserId, entries } = input
  const results: Array<{ user_id: string; id: string }> = []

  for (const entry of entries) {
    const userId = entry.user_id
    if (!userId) continue

    const reg = Math.max(0, Number(entry.regular_hours) || 0)
    const ot = Math.max(0, Number(entry.overtime_hours) || 0)

    const assignment = await loadPlanForWeek(supabase, userId, orgId, input.cutoffAt, { leftOrSaved: true })
    const plan = assignment?.comp_plans as (CompPlanForCalc & { hourly_rate?: number | null }) | null
    const hourlyRate = resolveHourlyRate({ hourlyRateOverride: assignment?.hourly_rate_override, compPlan: plan })
    // Only require a resolved hourly rate when actual hours are being recorded.
    // Commission-only reps (no hourly component) may appear on the entry table
    // but should not block saving when their hours are zero.
    if (hourlyRate == null && (reg > 0 || ot > 0)) {
      return { ok: false, status: 400, error: `No hourly rate for user ${userId}` }
    }
    const earnings = computeHourlyEarnings({ regularHours: reg, overtimeHours: ot, hourlyRate: hourlyRate ?? 0 })

    const { data: existing } = await supabase
      .from('payroll_rep_hours')
      .select('id, regular_hours, overtime_hours, notes, hourly_rate_snapshot, hourly_earnings')
      .eq('payroll_period_id', periodId)
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle()

    const { data: saved, error: saveErr } = await supabase
      .from('payroll_rep_hours')
      .upsert(
        {
          org_id: orgId,
          payroll_period_id: periodId,
          user_id: userId,
          regular_hours: reg,
          overtime_hours: ot,
          hourly_rate_snapshot: hourlyRate,
          hourly_earnings: earnings.total,
          notes: entry.notes ?? null,
        },
        { onConflict: 'payroll_period_id,user_id' }
      )
      .select('id')
      .single()

    if (isPeriodClaimedError(saveErr)) return { ok: false, status: 409, error: PERIOD_CLAIMED_MESSAGE }
    if (saveErr || !saved) {
      console.error('payroll_rep_hours upsert', saveErr)
      return { ok: false, status: 500, error: 'Failed to save hours' }
    }

    const auditReason = entry.reason || 'Admin hours entry'
    const fields: Array<{ field: string; oldVal: string | null; newVal: string }> = [
      { field: 'regular_hours', oldVal: existing?.regular_hours?.toString() ?? null, newVal: String(reg) },
      { field: 'overtime_hours', oldVal: existing?.overtime_hours?.toString() ?? null, newVal: String(ot) },
      { field: 'hourly_earnings', oldVal: existing?.hourly_earnings?.toString() ?? null, newVal: String(earnings.total) },
    ]
    if (entry.notes !== undefined) {
      fields.push({ field: 'notes', oldVal: (existing?.notes as string) ?? null, newVal: entry.notes ?? '' })
    }
    for (const f of fields) {
      if (f.oldVal === f.newVal) continue
      await supabase.from('payroll_rep_hours_audit').insert({
        org_id: orgId,
        rep_hours_id: saved.id,
        payroll_period_id: periodId,
        user_id: userId,
        actor_user_id: actorUserId,
        field_changed: f.field,
        old_value: f.oldVal,
        new_value: f.newVal,
        reason: auditReason,
      })
    }
    results.push({ user_id: userId, id: saved.id as string })
  }
  return { ok: true, saved: results }
}
