/**
 * Advances / draws (payroll phase 2): money given to a person ahead of pay and taken back from future checks by a rule.
 *
 * ONE definition of every part of it:
 *   - what is owed          = `advanceOutstanding`: the amount minus recovery lines on APPROVED weeks (never stored, so it cannot drift);
 *   - what a week recovers  = `planAdvanceRecoveries` (pure, below). The Pay screen shows its result as ordinary negative lines
 *                              ("Advance repaid") and Approve commits the same numbers: `payroll_commit_week` writes them from
 *                              the plan in the same transaction as everything else (migration 202611140070);
 *   - where it is counted   = the existing 'Adjustment' source in PAY_LINE_SOURCES (lib/payroll-week-total.ts). There is no new pay
 *                              source and no second total: a recovery is a signed adjustment line (kind 'advance_recovery').
 * A recovery never makes a check negative, and never takes a check below the person's weekly minimum unless the owner said it may
 * (`belowMinimumOk`). What cannot be taken stays owed and is tried again next week. Pure + loader only; the writers
 * (record / cancel) live in lib/payroll-advances-db.ts because they need the pay-week module.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'

export type RecoveryMode = 'full' | 'fixed' | 'percent'

export type AdvanceRow = {
  id: string
  userId: string
  amount: number
  givenOn: string
  note: string | null
  mode: RecoveryMode
  /** Dollars per week (fixed) or percent of that week's pay (percent); null for 'full'. */
  value: number | null
  /** The first pay week (its last day, company zone) that takes some back. */
  firstWeekEnding: string
  belowMinimumOk: boolean
  status: 'active' | 'cancelled'
  /** Taken back on approved weeks so far. */
  recovered: number
  /** The + line when it was paid on a pay week's check (otherwise it was paid outside payroll). */
  paidAdjustmentId: string | null
}

export const advanceOutstanding = (a: Pick<AdvanceRow, 'amount' | 'recovered'>) => Math.max(0, roundMoney(a.amount - a.recovered))

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

/** "All of what is left, from the week ending Nov 15" / "$100 a week" / "20% of each check". Pure. */
export function describeAdvanceRule(a: Pick<AdvanceRow, 'mode' | 'value' | 'belowMinimumOk'>): string {
  const base = a.mode === 'full' ? 'Whatever is left comes out of the next check' : a.mode === 'fixed' ? `${fmt(a.value ?? 0)} a week` : `${a.value ?? 0}% of each check`
  return a.belowMinimumOk ? `${base} (may go below the weekly minimum)` : base
}

export type RecoveryItem = { advanceId: string; userId: string; amount: number; reason: string }
export type RecoveryLimit = { advanceId: string; userId: string; wanted: number; taken: number; because: 'minimum' | 'pay' }
export type RecoveryPlan = { items: RecoveryItem[]; limited: RecoveryLimit[] }

/**
 * What this week takes back, per advance. Pure.
 *  - `pay`    = each person's check BEFORE recoveries (every other line summed, may be below 0);
 *  - `floors` = the least a check may be after a recovery: the person's (pro-rated) weekly minimum, else 0.
 * Advances of one person are taken oldest first from what is left of the check. An advance flagged `belowMinimumOk` ignores the
 * minimum (but never goes below $0). Cancelled advances, advances that start in a later week and advances already repaid take nothing.
 */
export function planAdvanceRecoveries(input: { weekEnding: string; advances: readonly AdvanceRow[]; pay: ReadonlyMap<string, number>; floors: ReadonlyMap<string, number> }): RecoveryPlan {
  const items: RecoveryItem[] = []
  const limited: RecoveryLimit[] = []
  const running = new Map<string, number>()
  const ordered = [...input.advances].sort((a, b) => a.givenOn.localeCompare(b.givenOn) || a.id.localeCompare(b.id))
  for (const a of ordered) {
    if (a.status !== 'active' || input.weekEnding < a.firstWeekEnding) continue
    const left = advanceOutstanding(a)
    if (left <= 0) continue
    const start = Math.max(0, roundMoney(input.pay.get(a.userId) ?? 0))
    const have = running.get(a.userId) ?? start
    const wanted = a.mode === 'full' ? left : a.mode === 'fixed' ? Math.min(left, roundMoney(a.value ?? 0)) : Math.min(left, roundMoney((start * (a.value ?? 0)) / 100))
    if (wanted <= 0) continue
    const floor = a.belowMinimumOk ? 0 : Math.max(0, roundMoney(input.floors.get(a.userId) ?? 0))
    const available = Math.max(0, roundMoney(have - floor))
    const taken = Math.min(wanted, available)
    if (taken < wanted) limited.push({ advanceId: a.id, userId: a.userId, wanted, taken, because: floor > 0 ? 'minimum' : 'pay' })
    if (taken <= 0) continue
    running.set(a.userId, roundMoney(have - taken))
    items.push({ advanceId: a.id, userId: a.userId, amount: taken, reason: `Advance repaid: ${fmt(taken)} of the ${fmt(a.amount)} given ${a.givenOn}${a.note ? ` (${a.note})` : ''}` })
  }
  return { items, limited }
}

/** Every advance of a company that can still matter (active, or cancelled with history only when asked), with what was recovered. */
export async function loadAdvances(admin: SupabaseClient, orgId: string, opts: { userIds?: string[]; includeCancelled?: boolean } = {}): Promise<AdvanceRow[]> {
  let q = admin.from('payroll_advances').select('id, user_id, amount, given_on, note, recovery_mode, recovery_value, first_week_ending, below_minimum_ok, status, paid_adjustment_id').eq('org_id', orgId)
  if (!opts.includeCancelled) q = q.eq('status', 'active')
  if (opts.userIds) q = q.in('user_id', opts.userIds)
  const { data, error } = await q.order('given_on', { ascending: true })
  if (error) {
    // Before the migration the table does not exist: no advances, never a failed screen.
    if ((error as { code?: string }).code === '42P01' || /does not exist|schema cache/i.test(String(error.message))) return []
    throw error
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  if (rows.length === 0) return []
  const recovered = new Map<string, number>()
  const { data: lines, error: linesErr } = await admin
    .from('payroll_adjustments')
    .select('advance_id, amount')
    .eq('org_id', orgId)
    .eq('kind', 'advance_recovery')
    .eq('status', 'applied')
    .in('advance_id', rows.map((r) => r.id as string))
  if (linesErr) throw linesErr
  for (const l of lines ?? []) recovered.set(l.advance_id as string, roundMoney((recovered.get(l.advance_id as string) ?? 0) - (Number(l.amount) || 0)))
  return rows.map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    amount: roundMoney(Number(r.amount) || 0),
    givenOn: String(r.given_on).slice(0, 10),
    note: (r.note as string | null) ?? null,
    mode: r.recovery_mode as RecoveryMode,
    value: r.recovery_value == null ? null : Number(r.recovery_value),
    firstWeekEnding: String(r.first_week_ending).slice(0, 10),
    belowMinimumOk: r.below_minimum_ok === true,
    status: r.status as 'active' | 'cancelled',
    recovered: recovered.get(r.id as string) ?? 0,
    paidAdjustmentId: (r.paid_adjustment_id as string | null) ?? null,
  }))
}

/** What the owner typed on the "Record an advance" sheet, checked. Pure. */
export function parseAdvanceInput(raw: { amount?: unknown; mode?: unknown; value?: unknown; note?: unknown }): { ok: true; amount: number; mode: RecoveryMode; value: number | null; note: string | null } | { ok: false; error: string } {
  const amount = roundMoney(Number(raw.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) return { ok: false, error: 'Enter the amount advanced (more than $0)' }
  const mode = raw.mode
  if (mode !== 'full' && mode !== 'fixed' && mode !== 'percent') return { ok: false, error: 'Choose how it is taken back' }
  let value: number | null = null
  if (mode === 'fixed') {
    value = roundMoney(Number(raw.value))
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: 'Enter how much comes out each week' }
    if (value > amount) return { ok: false, error: 'The weekly amount is more than the advance' }
  }
  if (mode === 'percent') {
    value = Math.round(Number(raw.value) * 100) / 100
    if (!Number.isFinite(value) || value <= 0 || value > 100) return { ok: false, error: 'Enter a percent between 1 and 100' }
  }
  const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 300) : null
  return { ok: true, amount, mode, value, note }
}
