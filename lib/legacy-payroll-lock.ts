import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { materializePayrollPeriod } from '@/lib/legacy-payroll-materialization'
import { PAYROLL_PERIOD_COLUMNS as PERIOD_COLUMNS } from '@/lib/payroll-period-lock'

/**
 * The payroll lock exactly as it ran on main before the atomic "Pay this week" approve. Used ONLY while PAYROLL_PAY_WEEK_ENABLED is
 * off (the ship default), so the release can go out with payroll behaving as it did. Delete this file and
 * lib/legacy-payroll-materialization.ts when the flag is turned on for good.
 */
// Full per-job reasons stay in `materialization.skippedJobs`. `already_snapshotted`
// (paid in an earlier period) is the normal case for every old job, so it is not counted.
function lockSummaryMessage(m: { payoutLinesCreated: number; skippedJobs: Array<{ reason: string }> }): string {
  const race = m.skippedJobs.filter((j) => j.reason === 'already_paid_by_race').length
  const blocked = m.skippedJobs.filter(
    (j) => j.reason !== 'already_snapshotted' && j.reason !== 'already_paid_by_race'
  ).length
  const parts = [`Period locked with ${m.payoutLinesCreated} payout line(s).`]
  if (race > 0) parts.push(`${race} job(s) skipped: another payroll lock paid them first.`)
  if (blocked > 0) parts.push(`${blocked} job(s) not yet payable.`)
  return parts.join(' ')
}

export async function legacyLockPayrollPeriod(
  supabase: SupabaseClient,
  input: { orgId: string; periodId: string; actorUserId: string; status: string; now: string }
): Promise<NextResponse> {
  const { orgId, periodId, actorUserId, status, now } = input
  const existing = { status }
  if (existing.status !== 'open') {
    return NextResponse.json({ error: 'Only open periods can be locked' }, { status: 409 })
  }

  // Guard: reject lock if any bonus lines are still pending approval
  const { count: pendingCount } = await supabase
    .from('payroll_bonus_lines')
    .select('id', { count: 'exact', head: true })
    .eq('payroll_period_id', periodId)
    .eq('org_id', orgId)
    .eq('status', 'pending_approval')

  if (pendingCount && pendingCount > 0) {
    return NextResponse.json(
      { error: `Cannot lock: ${pendingCount} bonus line(s) are still pending approval` },
      { status: 409 }
    )
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
    return NextResponse.json({ error: 'Failed to lock period' }, { status: 500 })
  }
  if (claimed !== true) {
    return NextResponse.json(
      {
        error: 'Cannot lock: this period is no longer open, or another lock, cancel or reopen is in progress.',
        code: 'lock_in_progress',
      },
      { status: 409 }
    )
  }

  try {
    let materialization
    try {
      materialization = await materializePayrollPeriod(supabase, {
        orgId,
        periodId,
        actorUserId: actorUserId,
      })
    } catch (materializeError) {
      console.error('period payout materialization', materializeError)
      return NextResponse.json(
        { error: 'Cannot lock: payable job snapshots and payout lines could not be generated' },
        { status: 500 }
      )
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
      return NextResponse.json({ error: 'Failed to lock period' }, { status: 500 })
    }
    if (!flipped) {
      console.error('period lock: claim lost before final flip', { orgId, periodId })
      return NextResponse.json(
        { error: 'Lock did not complete: the period changed while it was being locked. Review and retry.' },
        { status: 409 }
      )
    }

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
      return NextResponse.json(
        {
          error: `Lock rolled back: ${postLockPending} bonus line(s) became pending during lock. Review and retry.`,
        },
        { status: 409 }
      )
    }

    const { data: period } = await supabase
      .from('payroll_periods')
      .select(PERIOD_COLUMNS)
      .eq('id', periodId)
      .single()

    return NextResponse.json({
      period,
      materialization,
      message: lockSummaryMessage(materialization),
    })
  } finally {
    const { error: releaseErr } = await supabase
      .from('payroll_periods')
      .update({ lock_claimed_at: null, lock_claim_token: null })
      .eq('id', periodId)
      .eq('lock_claim_token', lockToken)
    if (releaseErr) console.error('period lock claim release (expires in 15 min)', releaseErr)
  }
}
