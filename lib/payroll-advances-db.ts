/** Writers for advances (record / cancel): owner only, each one SQL call (migration 202611140070). Rules live in lib/payroll-advances.ts. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { ensureNextOpenPeriod } from '@/lib/payroll-periods'
import { parseAdvanceInput } from '@/lib/payroll-advances'
import { resolvePayWeekPeriod } from '@/lib/payroll-pay-week'
import { cutoffYmd, nextWeekCutoff, ymdInZone } from '@/lib/payroll-week-schedule'
import { loadPayWeekSchedule } from '@/lib/payroll-week-schedule-server'

export type AdvanceWriteResult = { ok: true; id: string; firstWeekEnding: string } | { ok: false; status: number; error: string }

const MESSAGES: Array<[RegExp, number, string]> = [
  [/owner_only/, 403, 'Only an owner can record or cancel an advance.'],
  [/person_not_found/, 404, 'Person not found'],
  [/week_not_open/, 409, 'That week is already approved or being approved. Try again in a minute.'],
  [/recover_after_paid_week/, 409, 'An advance paid on a check starts coming back the week after.'],
  [/payroll_period_claimed/, 409, 'This week is being approved right now. Try again in a minute.'],
  [/not_found/, 404, 'Advance not found'],
  [/already_cancelled/, 409, 'That advance is already stopped'],
]
const mapError = (e: { message?: string }): { status: number; error: string } => {
  const m = String(e.message ?? '')
  for (const [re, status, error] of MESSAGES) if (re.test(m)) return { status, error }
  console.error('payroll advance', e)
  return { status: 500, error: 'Could not save. Nothing changed.' }
}

/** The week the next Approve covers: the week that just ended if it is still open, else the next open one. */
export async function firstOpenWeek(admin: SupabaseClient, orgId: string, now: Date) {
  const s = await loadPayWeekSchedule(admin, orgId)
  const current = await resolvePayWeekPeriod(admin, orgId, now, null, s)
  if (current.status === 'open') return { id: current.id, weekEnding: current.weekEnding, cutoffAt: current.cutoffAt, schedule: s }
  const next = await ensureNextOpenPeriod(admin, orgId, current.cutoffAt)
  const p = await resolvePayWeekPeriod(admin, orgId, now, next.id, s)
  return { id: p.id, weekEnding: p.weekEnding, cutoffAt: p.cutoffAt, schedule: s }
}

export async function recordAdvance(
  admin: SupabaseClient,
  input: { orgId: string; actorUserId: string; userId: string; amount: unknown; mode: unknown; value: unknown; note?: unknown; startWeek: 'this' | 'next'; payOnCheck: boolean; belowMinimumOk: boolean; now?: Date }
): Promise<AdvanceWriteResult> {
  const now = input.now ?? new Date()
  const parsed = parseAdvanceInput(input)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  const open = await firstOpenWeek(admin, input.orgId, now)
  // Paid on a check: that week cannot also take it back, so recovery starts the week after.
  const next = cutoffYmd(nextWeekCutoff(open.cutoffAt, open.schedule), open.schedule)
  const first = input.payOnCheck || input.startWeek === 'next' ? next : open.weekEnding
  const { data, error } = await admin.rpc('payroll_record_advance', {
    p_org_id: input.orgId,
    p_actor: input.actorUserId,
    p_user: input.userId,
    p_amount: parsed.amount,
    p_mode: parsed.mode,
    p_value: parsed.value,
    p_given_on: ymdInZone(now, open.schedule.timeZone),
    p_first_week_ending: first,
    p_note: parsed.note,
    p_pay_period_id: input.payOnCheck ? open.id : null,
    p_below_ok: input.belowMinimumOk,
  })
  if (error) return { ok: false, ...mapError(error) }
  return { ok: true, id: data as string, firstWeekEnding: first }
}

export async function cancelAdvance(admin: SupabaseClient, input: { orgId: string; actorUserId: string; advanceId: string; reason?: string }): Promise<{ ok: true; writtenOff: number; withdrawn: boolean } | { ok: false; status: number; error: string }> {
  const { data, error } = await admin.rpc('payroll_cancel_advance', { p_org_id: input.orgId, p_actor: input.actorUserId, p_advance: input.advanceId, p_reason: input.reason ?? '' })
  if (error) return { ok: false, ...mapError(error) }
  const r = data as { written_off: number; withdrawn: boolean }
  return { ok: true, writtenOff: Number(r.written_off) || 0, withdrawn: r.withdrawn === true }
}

/** Owner flips "may go below the weekly minimum" on an advance (a plain flag; every recovery re-checks it). */
export async function setBelowMinimumOk(admin: SupabaseClient, input: { orgId: string; actorUserId: string; advanceId: string; ok: boolean }): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { data: actor } = await admin.from('users').select('is_super_admin, active').eq('id', input.actorUserId).eq('org_id', input.orgId).maybeSingle()
  if (!actor || actor.is_super_admin !== true || actor.active === false) return { ok: false, status: 403, error: 'Only an owner can allow that.' }
  const { error } = await admin.from('payroll_advances').update({ below_minimum_ok: input.ok }).eq('id', input.advanceId).eq('org_id', input.orgId).eq('status', 'active')
  return error ? { ok: false, status: 500, error: 'Could not save' } : { ok: true }
}

/**
 * Per person: what this approved week took back for advances that were paid OUTSIDE payroll (no + line on any check). The provider
 * export maps those differently from advances paid on a check (settings.payrollExport.advance). Positive dollars.
 */
export async function loadOffCheckRepaid(admin: SupabaseClient, orgId: string, periodId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const { data: rec } = await admin.from('payroll_adjustments').select('user_id, advance_id, amount').eq('org_id', orgId).eq('payroll_period_id', periodId).eq('kind', 'advance_recovery').neq('status', 'void')
  const ids = Array.from(new Set((rec ?? []).map((r) => r.advance_id as string).filter(Boolean)))
  if (ids.length === 0) return out
  const { data: adv } = await admin.from('payroll_advances').select('id, paid_adjustment_id').eq('org_id', orgId).in('id', ids)
  const offCheck = new Set((adv ?? []).filter((a) => !a.paid_adjustment_id).map((a) => a.id as string))
  for (const r of rec ?? []) {
    if (!offCheck.has(r.advance_id as string)) continue
    out.set(r.user_id as string, roundMoney((out.get(r.user_id as string) ?? 0) - (Number(r.amount) || 0)))
  }
  return out
}
