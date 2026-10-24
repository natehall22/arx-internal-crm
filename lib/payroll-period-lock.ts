import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { loadPayWeekFull, type PayWeekFull } from '@/lib/payroll-pay-week'
import { ensureNextOpenPeriod } from '@/lib/payroll-periods'

export const PAYROLL_PERIOD_COLUMNS =
  'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'

export type CommitSummary = { total: number; people: number; snapshots: number; lines: number; carried: number }

export type LockResult =
  | { ok: true; period: unknown; summary: CommitSummary; message: string }
  | { ok: false; status: number; body: { error: string; code?: string; total?: number } }

export function commitSummaryMessage(s: CommitSummary): string {
  return `Period locked with ${s.lines} payout line(s).`
}

/** What `payroll_commit_week` (migration 202610280010) writes, built from the one plan the screen showed. Pure. */
export function buildCommitPlan(full: PayWeekFull) {
  const jobs = (full.plan?.jobs ?? []).map((j) => ({
    job_id: j.job.id,
    // The commit refuses if the live job no longer matches what the plan was computed from.
    sale_amount: j.job.sale_amount,
    commission_comp_base: j.job.commission_comp_base,
    snapshot: j.snapshotRow,
    lines: j.rows,
    state: j.stateRow,
  }))
  const units = Array.from(full.units.entries()).map(([user_id, v]) => ({ user_id, amount: roundMoney(v.total), detail: v.detail }))
  return { jobs, units }
}

/** Turns a Postgres exception raised by payroll_commit_week into the response the admin sees. Pure. */
export function mapCommitError(error: { message?: string; code?: string }, computedTotal: number): Extract<LockResult, { ok: false }> {
  const msg = String(error.message ?? '')
  if (/payroll_commit:claim_lost/.test(msg)) return { ok: false, status: 409, body: { error: 'Lock did not complete: the period changed while it was being locked. Review and retry.', code: 'lock_in_progress' } }
  if (/payroll_commit:earlier_week_open/.test(msg)) {
    return { ok: false, status: 409, body: { error: "An earlier week still has fixes waiting on it. Approve that week first, so they aren't stranded.", code: 'earlier_week_open' } }
  }
  if (/payroll_commit:(total_mismatch|job_changed)|payroll_already_paid/.test(msg)) {
    return { ok: false, status: 409, body: { error: 'The numbers changed while approving. Nothing was paid; review them again.', code: 'changed', total: computedTotal } }
  }
  if (/payroll_commit:not_found/.test(msg)) return { ok: false, status: 404, body: { error: 'Week not found' } }
  console.error('payroll_commit_week', error)
  return { ok: false, status: 500, body: { error: 'Could not approve. Nothing was paid; refresh and try again.' } }
}

/**
 * Locks (= approves) an OPEN payroll period as ONE database step.
 *
 *   1. claim the period (`payroll_claim_period_lock`) — from here until the commit, the hours / bonus / fix writers are
 *      refused by a database trigger, so the numbers cannot move under the calculation;
 *   2. compute the plan once (`loadPayWeekFull`, the same function the preview runs);
 *   3. refuse if its total is not the total the admin approved;
 *   4. hand the whole write set to `payroll_commit_week`, which writes the snapshots, lines, job state, frozen per-unit pay,
 *      re-validates the total from the tables, carries negative checks, applies the week's fixes and flips to `locked` in a
 *      single transaction. Any failure rolls everything back.
 *
 * The one lock path ("Pay this week → Approve"). `expectedTotal` is the total the admin was shown; omitted, the freshly computed total is used.
 */
export async function lockPayrollPeriod(
  supabase: SupabaseClient,
  input: {
    orgId: string
    periodId: string
    actorUserId: string
    status: string
    expectedTotal?: number
    now?: Date
  }
): Promise<LockResult> {
  const { orgId, periodId, actorUserId } = input
  const now = input.now ?? new Date()

  if (input.status !== 'open') return { ok: false, status: 409, body: { error: 'Only open periods can be locked' } }

  // Claim BEFORE reading anything: a second lock, a cancel, a reopen or an hours/bonus/fix write cannot run against it now.
  const lockToken = randomUUID()
  const { data: claimed, error: claimErr } = await supabase.rpc('payroll_claim_period_lock', { p_org_id: orgId, p_period_id: periodId, p_token: lockToken })
  if (claimErr) {
    console.error('period lock claim', claimErr)
    return { ok: false, status: 500, body: { error: 'Failed to lock period' } }
  }
  if (claimed !== true) {
    return { ok: false, status: 409, body: { error: 'Cannot lock: this period is no longer open, or another lock, cancel or reopen is in progress.', code: 'lock_in_progress' } }
  }

  let committed = false
  try {
    let full: PayWeekFull
    try {
      full = await loadPayWeekFull(supabase, orgId, now, periodId)
    } catch (e) {
      console.error('period lock: calculation failed', e)
      return { ok: false, status: 500, body: { error: 'Cannot lock: the pay calculation failed. Nothing was paid.' } }
    }
    const computed = full.week.totals.amount
    if (full.week.state !== 'draft') return { ok: false, status: 409, body: { error: 'This week is already approved' } }
    if (input.expectedTotal != null && Math.round(computed * 100) !== Math.round(input.expectedTotal * 100)) {
      return { ok: false, status: 409, body: { error: 'The numbers changed while you were looking. Review them again.', code: 'changed', total: computed } }
    }
    const plan = buildCommitPlan(full)
    const hasNegative = full.week.people.some((p) => p.raw < 0)
    // A $0 week still approves when there are snapshots to write (jobs that pay nothing) or a balance to carry.
    if (computed <= 0 && plan.jobs.length === 0 && !hasNegative) {
      return { ok: false, status: 409, body: { error: 'Nothing to pay this week' } }
    }
    const next = hasNegative ? await ensureNextOpenPeriod(supabase, orgId, full.week.period.cutoffAt) : null

    const { data, error } = await supabase.rpc('payroll_commit_week', {
      p_org_id: orgId,
      p_period_id: periodId,
      p_token: lockToken,
      p_actor_user_id: actorUserId,
      p_expected_total: computed,
      p_next_period_id: next?.id ?? null,
      p_plan: plan,
    })
    if (error) return mapCommitError(error, computed)
    committed = true
    const summary = data as unknown as CommitSummary
    const { data: period } = await supabase.from('payroll_periods').select(PAYROLL_PERIOD_COLUMNS).eq('id', periodId).single()
    return { ok: true, period, summary, message: commitSummaryMessage(summary) }
  } finally {
    if (!committed) {
      // The commit clears the claim itself; on any other exit release it so the week is editable again (it expires in 15 min regardless).
      const { error: releaseErr } = await supabase.from('payroll_periods').update({ lock_claimed_at: null, lock_claim_token: null }).eq('id', periodId).eq('lock_claim_token', lockToken)
      if (releaseErr) console.error('period lock claim release (expires in 15 min)', releaseErr)
    }
  }
}
