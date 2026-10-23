import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { materializePayrollPeriod, type MaterializePayrollPeriodResult } from '@/lib/payroll-period-materialization'

export const PAYROLL_PERIOD_COLUMNS =
  'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'

// Full per-job reasons stay in `materialization.skippedJobs`. `already_snapshotted`
// (paid in an earlier period) is the normal case for every old job, so it is not counted.
export function lockSummaryMessage(m: { payoutLinesCreated: number; skippedJobs: Array<{ reason: string }> }): string {
  const race = m.skippedJobs.filter((j) => j.reason === 'already_paid_by_race').length
  const blocked = m.skippedJobs.filter((j) => j.reason !== 'already_snapshotted' && j.reason !== 'already_paid_by_race').length
  const parts = [`Period locked with ${m.payoutLinesCreated} payout line(s).`]
  if (race > 0) parts.push(`${race} job(s) skipped: another payroll lock paid them first.`)
  if (blocked > 0) parts.push(`${blocked} job(s) not yet payable.`)
  return parts.join(' ')
}

export type LockResult =
  | { ok: true; period: unknown; materialization: MaterializePayrollPeriodResult; message: string }
  | { ok: false; status: number; body: { error: string; code?: string } }

/**
 * Locks (= approves) an OPEN payroll period: claims it atomically, materializes the payout lines (the same calculation the
 * preview shows), flips it to `locked`, and rolls back if a bonus line became pending meanwhile. Shared by the period
 * API and "Pay this week → Approve" so there is exactly one lock path.
 *
 * `requireNoPendingBonuses` keeps the legacy rule for the period API; the weekly flow rolls pending bonuses forward
 * first, so it never trips the guard.
 */
export async function lockPayrollPeriod(
  supabase: SupabaseClient,
  input: { orgId: string; periodId: string; actorUserId: string; status: string; requireNoPendingBonuses?: boolean }
): Promise<LockResult> {
  const { orgId, periodId, actorUserId } = input
  const requireNoPending = input.requireNoPendingBonuses !== false
  const now = new Date().toISOString()

  if (input.status !== 'open') {
    return { ok: false, status: 409, body: { error: 'Only open periods can be locked' } }
  }

  if (requireNoPending) {
    // Guard: reject lock if any bonus lines are still pending approval
    const { count: pendingCount } = await supabase
      .from('payroll_bonus_lines')
      .select('id', { count: 'exact', head: true })
      .eq('payroll_period_id', periodId)
      .eq('org_id', orgId)
      .eq('status', 'pending_approval')
    if (pendingCount && pendingCount > 0) {
      return { ok: false, status: 409, body: { error: `Cannot lock: ${pendingCount} bonus line(s) are still pending approval` } }
    }
  }

  // Claim the period atomically (open + no live claim) BEFORE writing anything, so a
  // second lock, a cancel or a reopen can't run against it at the same time. The
  // claim is released in `finally`; a crashed request's claim expires after 15 min.
  const lockToken = randomUUID()
  const { data: claimed, error: claimErr } = await supabase.rpc('payroll_claim_period_lock', {
    p_org_id: orgId,
    p_period_id: periodId,
    p_token: lockToken,
  })
  if (claimErr) {
    console.error('period lock claim', claimErr)
    return { ok: false, status: 500, body: { error: 'Failed to lock period' } }
  }
  if (claimed !== true) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'Cannot lock: this period is no longer open, or another lock, cancel or reopen is in progress.',
        code: 'lock_in_progress',
      },
    }
  }

  try {
    let materialization: MaterializePayrollPeriodResult
    try {
      materialization = await materializePayrollPeriod(supabase, { orgId, periodId, actorUserId })
    } catch (materializeError) {
      console.error('period payout materialization', materializeError)
      return { ok: false, status: 500, body: { error: 'Cannot lock: payable job snapshots and payout lines could not be generated' } }
    }

    // Only the claim holder can flip it, and only from open.
    const { data: flipped, error: updErr } = await supabase
      .from('payroll_periods')
      .update({ status: 'locked', locked_at: now })
      .eq('id', periodId)
      .eq('org_id', orgId)
      .eq('status', 'open')
      .eq('lock_claim_token', lockToken)
      .select('id')
      .maybeSingle()

    if (updErr) {
      console.error('period lock', updErr)
      return { ok: false, status: 500, body: { error: 'Failed to lock period' } }
    }
    if (!flipped) {
      console.error('period lock: claim lost before final flip', { orgId, periodId })
      return { ok: false, status: 409, body: { error: 'Lock did not complete: the period changed while it was being locked. Review and retry.' } }
    }

    if (requireNoPending) {
      // TOCTOU re-check: a concurrent 444 sync could have inserted pending_approval lines
      // between the first guard and the UPDATE. Re-verify and roll back if so.
      const { count: postLockPending } = await supabase
        .from('payroll_bonus_lines')
        .select('id', { count: 'exact', head: true })
        .eq('payroll_period_id', periodId)
        .eq('org_id', orgId)
        .eq('status', 'pending_approval')

      if (postLockPending && postLockPending > 0) {
        await supabase
          .from('payroll_periods')
          .update({ status: 'open', locked_at: null })
          .eq('id', periodId)
          .eq('org_id', orgId)
          .eq('status', 'locked')
          .eq('lock_claim_token', lockToken)
        return {
          ok: false,
          status: 409,
          body: { error: `Lock rolled back: ${postLockPending} bonus line(s) became pending during lock. Review and retry.` },
        }
      }
    }

    const { data: period } = await supabase.from('payroll_periods').select(PAYROLL_PERIOD_COLUMNS).eq('id', periodId).single()
    return { ok: true, period, materialization, message: lockSummaryMessage(materialization) }
  } finally {
    const { error: releaseErr } = await supabase
      .from('payroll_periods')
      .update({ lock_claimed_at: null, lock_claim_token: null })
      .eq('id', periodId)
      .eq('lock_claim_token', lockToken)
    if (releaseErr) console.error('period lock claim release (expires in 15 min)', releaseErr)
  }
}
