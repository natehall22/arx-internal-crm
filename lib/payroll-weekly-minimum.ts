/**
 * Weekly minimum — a pay-plan rule: "the person gets the GREATER of a fixed amount or their commission for the week" (the two are
 * not added). Generic: any company can put it on any plan (`comp_plans.weekly_minimum = { amount, needsCheck }`). One company's Field
 * Marketer agreement is one use: $500 weekly performance pay or 3% of commissionable sale value, whichever is greater, the $500 only
 * when that Monday–Sunday week's requirements were completed and verified (`needsCheck`: the office answers yes/no each week).
 *
 * It is paid as ONE line, "Weekly minimum", that tops the commission up to the amount, with its math. Only commission lines count
 * toward the comparison (not hourly, per-unit, bonuses or fixes). An approved week stores the top-up (payroll_week_minimums.amount,
 * written by payroll_commit_week) and is never recalculated.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { isMissingColumn, isMissingTable } from '@/lib/supabase/errors'

/**
 * amount: the weekly minimum for a normal 7-day week. needsCheck: the office confirms the week's requirements were met.
 * prorate (default true): a week that is not 7 days long (the one in-between week after a pay-week change: 1–13 days) gets
 * amount × days / 7. Off = the full amount whatever the week's length.
 */
export type WeeklyMinimumRule = { amount: number; needsCheck: boolean; prorate: boolean; basis: MinimumBasis }

/**
 * What the minimum is compared with (the plan's `basis`):
 *   'gross' (default): everything the person EARNED that week — commission, hourly, per-unit pay, bonuses, and fixes tied to a job
 *                      (clawbacks included, so a -$300 job fix lowers it). Carried balances and fixes with no job (advances, draws,
 *                      other repayments) are applied AFTER the floor, never inside it.
 *   'commission':      commission lines + job fixes only.
 */
export type MinimumBasis = 'gross' | 'commission'

/** The stored rule, or null when the plan has none / it is malformed. Pure. */
export function parseWeeklyMinimum(raw: unknown): WeeklyMinimumRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const amount = Number(r.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) return null
  return { amount: roundMoney(amount), needsCheck: r.needsCheck !== false, prorate: r.prorate !== false, basis: r.basis === 'commission' ? 'commission' : 'gross' }
}

/** What the office may save as a rule (null clears it). */
export function validateWeeklyMinimumInput(raw: unknown): { ok: true; value: WeeklyMinimumRule | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null }
  const rule = parseWeeklyMinimum(raw)
  if (!rule) return { ok: false, error: 'The weekly minimum must be a dollar amount above $0.' }
  return { ok: true, value: rule }
}

export type WeeklyMinimumOutcome =
  | { state: 'pays'; topUp: number }
  /** Commission already reaches the minimum: nothing to add, nothing to ask. */
  | { state: 'commission_higher'; topUp: 0 }
  /** The office has not answered "were this week's requirements met?" yet. */
  | { state: 'needs_answer'; topUp: number }
  | { state: 'not_met'; topUp: 0 }

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

/**
 * The top-up for one person for one week. `met` = the office's answer (null = not answered). `stillHere` = active at the cutoff:
 * someone who left during the week is paid the minimum only on an explicit yes, even when the plan needs no check. Pure.
 */
export function weeklyMinimumOutcome(rule: WeeklyMinimumRule, commission: number, met: boolean | null, stillHere: boolean, weekDays = 7): WeeklyMinimumOutcome {
  const gap = roundMoney(weekMinimumFor(rule, weekDays) - roundMoney(commission))
  if (gap <= 0) return { state: 'commission_higher', topUp: 0 }
  if (met === false) return { state: 'not_met', topUp: 0 }
  if (met === true) return { state: 'pays', topUp: gap }
  if (rule.needsCheck || !stillHere) return { state: 'needs_answer', topUp: gap }
  return { state: 'pays', topUp: gap }
}

/** The minimum for a week of `weekDays` days (pro-rated when the rule says so). Pure. */
export function weekMinimumFor(rule: WeeklyMinimumRule, weekDays: number): number {
  if (!rule.prorate || weekDays === 7 || !(weekDays > 0)) return rule.amount
  return roundMoney((rule.amount * weekDays) / 7)
}

/**
 * Which of a person's lines count toward the minimum, for the plan's basis (see MinimumBasis). Never counted: carried balances,
 * fixes with no job, and the minimum line itself. Pure.
 */
export function countsTowardMinimum(line: { kind: string; adjustmentKind?: string | null; jobId?: string | null }, basis: MinimumBasis = 'gross'): boolean {
  if (line.kind === 'Commission') return true
  if (line.kind === 'Adjustment') return line.adjustmentKind === 'fix' && !!line.jobId
  if (basis === 'gross') return line.kind === 'Hourly' || line.kind === 'Units' || line.kind === 'Bonus'
  return false
}

/** The person's basis total for the week from their lines. Pure. */
export function minimumBasisTotal(lines: ReadonlyArray<{ kind: string; amount: number; adjustmentKind?: string | null; jobId?: string | null }>, basis: MinimumBasis): number {
  return lines.filter((l) => countsTowardMinimum(l, basis)).reduce((s, l) => roundMoney(s + roundMoney(l.amount)), 0)
}

/** "Greater of $500 or commission: $500 − $180 commission = $320". Pure. */
export function weeklyMinimumMath(minimum: number, earned: number, topUp: number, weekDays = 7, basis: MinimumBasis = 'gross'): string {
  const short = weekDays !== 7 ? ` (${weekDays}-day week)` : ''
  const what = basis === 'commission' ? 'commission' : 'earnings'
  return `Greater of ${fmt(minimum)}${short} or ${what}: ${fmt(minimum)} − ${fmt(roundMoney(earned))} ${basis === 'commission' ? 'commission' : 'earned'} = ${fmt(topUp)}`
}

export type WeekMinimum = { userId: string; amount: number; detail: { minimum: number; commission: number; planName: string | null; weekDays?: number; basis?: MinimumBasis } }

export type MinimumDecision = { met: boolean | null }

/** The office's answers for a week (user → met). Before the migration the table is missing: no answers. */
export async function loadMinimumDecisions(admin: SupabaseClient, orgId: string, periodId: string): Promise<Map<string, { met: boolean | null; amount: number; detail: WeekMinimum['detail'] | null }>> {
  const out = new Map<string, { met: boolean | null; amount: number; detail: WeekMinimum['detail'] | null }>()
  const { data, error } = await admin.from('payroll_week_minimums').select('user_id, met, amount, detail').eq('org_id', orgId).eq('payroll_period_id', periodId)
  if (error) {
    if (isMissingTable(error) || isMissingColumn(error, 'met')) return out
    throw error
  }
  for (const r of data ?? []) out.set(r.user_id as string, { met: (r.met as boolean | null) ?? null, amount: Number(r.amount) || 0, detail: (r.detail as WeekMinimum['detail'] | null) ?? null })
  return out
}

/** Saves the office's yes/no for one person's week. The writer guard refuses it once the week is approved or being approved. */
export async function saveMinimumDecision(admin: SupabaseClient, input: { orgId: string; periodId: string; userId: string; met: boolean; actorUserId: string }) {
  // org-scope-ok: keyed on (week, person); the caller loaded the week company-scoped and org_id is stamped on the row
  return admin
    .from('payroll_week_minimums')
    .upsert(
      { org_id: input.orgId, payroll_period_id: input.periodId, user_id: input.userId, met: input.met, decided_by: input.actorUserId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'payroll_period_id,user_id' }
    )
}
