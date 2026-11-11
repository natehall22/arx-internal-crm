import type { SupabaseClient } from '@supabase/supabase-js'

import { nextWeekCutoff, payDateFor, sameWeekEnding, weekLabel, type PayWeekSchedule } from '@/lib/payroll-week-schedule'
import { loadPayWeekSchedule } from '@/lib/payroll-week-schedule-server'

export type PeriodRow = { id: string; period_label: string | null; cutoff_at: string; scheduled_pay_date: string; status: string; units_frozen_at?: string | null }
export const PERIOD_COLS = 'id, period_label, cutoff_at, scheduled_pay_date, status, units_frozen_at, created_at'

/**
 * The non-cancelled week closing at `target`: its cutoff is on the same calendar date in the company's zone (hand-typed legacy
 * cutoffs at another hour still match; a week one day off — e.g. the old Wednesday next to a new Thursday — never does).
 * Earliest created first.
 */
export async function findWeekNear(admin: SupabaseClient, orgId: string, target: Date, s: Pick<PayWeekSchedule, 'timeZone'>, opts: { openOnly?: boolean } = {}): Promise<PeriodRow | null> {
  let q = admin
    .from('payroll_periods')
    .select(PERIOD_COLS)
    .eq('org_id', orgId)
    .neq('status', 'cancelled')
    .gte('cutoff_at', new Date(target.getTime() - 36 * 3_600_000).toISOString())
    .lte('cutoff_at', new Date(target.getTime() + 36 * 3_600_000).toISOString())
  if (opts.openOnly) q = q.eq('status', 'open')
  const { data, error } = await q.order('created_at', { ascending: true }).limit(10)
  if (error) throw error
  return ((data ?? []) as PeriodRow[]).find((r) => sameWeekEnding(r.cutoff_at, target, s)) ?? null
}

/**
 * Find-or-create the week closing at `target` (the ONE place a week row is made: Pay screen, next week, fixes). Two people at once:
 * the loser's insert hits the unique label and re-reads the winner's row. A CANCELLED week that already holds the label (an
 * emptied old week) gets the new row a suffixed label instead of blocking the week forever.
 */
export async function findOrCreateWeek(admin: SupabaseClient, orgId: string, target: Date, s: PayWeekSchedule): Promise<{ id: string; status: string; cutoff_at: string }> {
  const existing = await findWeekNear(admin, orgId, target, s)
  if (existing) return existing
  const row = { org_id: orgId, cutoff_at: target.toISOString(), lock_at: target.toISOString(), scheduled_pay_date: payDateFor(target, s), status: 'open' }
  for (const label of [weekLabel(target, s), `${weekLabel(target, s)} (2)`, `${weekLabel(target, s)} (3)`]) {
    const { error } = await admin.from('payroll_periods').insert({ ...row, period_label: label })
    if (error && (error as { code?: string }).code !== '23505') throw error
    const found = await findWeekNear(admin, orgId, target, s)
    if (found) return found
  }
  throw new Error('Could not create the pay week')
}

/**
 * The OPEN week after the one closing at `cutoffAt`, created if it does not exist yet. "Next" is the company's CURRENT schedule:
 * after a pay-week change, the week after an old Wednesday week is the first new Sunday week (nextWeekCutoff), never another
 * Wednesday. The one place "next week" is found.
 */
export async function ensureNextOpenPeriod(admin: SupabaseClient, orgId: string, cutoffAt: string): Promise<{ id: string }> {
  const s = await loadPayWeekSchedule(admin, orgId)
  // Walk forward week by week: the first week that is OPEN takes the line; one that is already approved is skipped (a fix for an
  // old week lands on the next week that can still change); one that does not exist yet is created.
  let target = nextWeekCutoff(cutoffAt, s)
  for (let k = 1; k <= 8; k++) {
    const row = await findOrCreateWeek(admin, orgId, target, s)
    if (row.status === 'open') return { id: row.id }
    target = nextWeekCutoff(target, s)
  }
  throw new Error('Could not find an open week to put this on')
}

/** The message the payroll writers show while a week is being approved (the database refuses their write). */
export const PERIOD_CLAIMED_MESSAGE = 'This week is being approved right now. Try again in a minute.'
export const PERIOD_CLOSED_MESSAGE = 'This week is already approved, so its hours, bonuses and fixes can no longer change. Put the fix on the next open week.'

/** True when Postgres refused a payroll write for the week's state (SQLSTATE 55006: live approval claim, week already approved, or week frozen). */
export function isPeriodClaimedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return code === '55006' || (typeof message === 'string' && /payroll_period_(claimed|not_open|frozen)/.test(message))
}

/** The plain-English reason for such a refusal. */
export function periodRefusalMessage(error: unknown): string {
  const msg = String((error as { message?: unknown } | null)?.message ?? '')
  return /payroll_period_(not_open|frozen)/.test(msg) ? PERIOD_CLOSED_MESSAGE : PERIOD_CLAIMED_MESSAGE
}
