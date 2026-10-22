import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { materializePayrollPeriod } from '@/lib/payroll-period-materialization'

export const dynamic = 'force-dynamic'

type PeriodAction = 'lock' | 'mark_paid' | 'cancel' | 'reopen'

const PERIOD_COLUMNS =
  'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'

/**
 * Crashed-lock window. Defined in TWO places: here and as interval '15 minutes' in
 * payroll_claim_period_lock() and payroll_cancel_or_reopen_period()
 * (supabase/migrations/202610210002_payroll_no_cross_period_double_pay.sql). Change both.
 */
const LOCK_CLAIM_STALE_MS = 15 * 60 * 1000

/** PostgREST `or` filter: no claim, or a claim old enough to be a crashed lock. */
function noLiveClaimFilter(): string {
  const staleBefore = new Date(Date.now() - LOCK_CLAIM_STALE_MS).toISOString()
  return `lock_claimed_at.is.null,lock_claimed_at.lt."${staleBefore}"`
}

function periodBusyResponse(what: string) {
  return NextResponse.json(
    {
      error: `Cannot ${what}: the period changed or a lock is in progress. Refresh and try again.`,
      code: 'lock_in_progress',
    },
    { status: 409 }
  )
}

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { periodId: string } }
) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPayrollAdminRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as {
      action?: PeriodAction
      period_label?: string
      cutoff_at?: string
      lock_at?: string
      scheduled_pay_date?: string
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id
    const periodId = params.periodId

    const { data: existing, error: loadErr } = await supabase
      .from('payroll_periods')
      .select('id, status, locked_at')
      .eq('id', periodId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (loadErr || !existing) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    if (body.action === 'lock') {
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
            actorUserId: profile.id,
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

    if (body.action === 'mark_paid') {
      if (existing.status !== 'locked') {
        return NextResponse.json({ error: 'Only locked periods can be marked paid' }, { status: 409 })
      }
      const { data: period, error } = await supabase
        .from('payroll_periods')
        .update({ status: 'paid', paid_at: now })
        .eq('id', periodId)
        .eq('org_id', orgId)
        .eq('status', 'locked')
        .or(noLiveClaimFilter())
        .select(PERIOD_COLUMNS)
        .maybeSingle()
      if (error) return NextResponse.json({ error: 'Failed to mark paid' }, { status: 500 })
      if (!period) return periodBusyResponse('mark paid')
      return NextResponse.json({ period })
    }

    // Cancel / reopen run as ONE transaction in Postgres (payroll_cancel_or_reopen_period,
    // migration 202610210002) under a row lock on the period, so status checks, cleanup
    // and the status change can't interleave with a lock. It refuses while a lock claim
    // is live, refuses a locked/paid/cancelled period that has payout lines (those stay
    // put; correct with an adjustment), refuses chargeback applications, and for an OPEN
    // period (a lock that never finished) deletes the partial snapshots + lines, clears
    // the jobs' job_payroll_state period pointer, and writes payroll_override_audit.
    if (body.action === 'cancel' || body.action === 'reopen') {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('payroll_cancel_or_reopen_period', {
        p_org_id: orgId,
        p_period_id: periodId,
        p_action: body.action,
        p_actor_user_id: profile.id,
      })
      if (rpcErr) {
        console.error(`period ${body.action}`, rpcErr)
        return NextResponse.json({ error: `Failed to ${body.action} period` }, { status: 500 })
      }
      const result = (rpcData || {}) as {
        ok?: boolean
        code?: string
        snapshot_count?: number
        application_count?: number
        snapshots_deleted?: number
      }
      if (!result.ok) {
        switch (result.code) {
          case 'not_found':
            return NextResponse.json({ error: 'Period not found' }, { status: 404 })
          case 'lock_in_progress':
            return NextResponse.json(
              { error: `Cannot ${body.action}: a lock of this period is in progress. Try again shortly.`, code: result.code },
              { status: 409 }
            )
          case 'period_has_payout_lines':
            return NextResponse.json(
              {
                error: `Cannot ${body.action}: this period already has payout lines for ${result.snapshot_count} job(s). Correct pay with an adjustment instead.`,
                code: result.code,
              },
              { status: 409 }
            )
          case 'period_has_chargeback_applications':
            return NextResponse.json(
              {
                error: `Cannot ${body.action}: ${result.application_count} chargeback application(s) are recorded against this period.`,
                code: result.code,
              },
              { status: 409 }
            )
          default:
            console.error(`period ${body.action}: unexpected result`, result)
            return NextResponse.json({ error: `Failed to ${body.action} period` }, { status: 500 })
        }
      }
      const cleared = result.snapshots_deleted ?? 0
      if (cleared > 0) {
        console.warn(`period ${body.action}: cleared partial lock rows (audited)`, { orgId, periodId, cleared })
      }
      const { data: period } = await supabase
        .from('payroll_periods')
        .select(PERIOD_COLUMNS)
        .eq('id', periodId)
        .single()
      return NextResponse.json({
        period,
        ...(cleared > 0
          ? { message: `Cleared ${cleared} unfinished job snapshot(s) from a lock that never completed.` }
          : {}),
      })
    }

    if (existing.status !== 'open') {
      return NextResponse.json({ error: 'Period is not open for edits' }, { status: 409 })
    }

    const patch: Record<string, unknown> = {}
    if (body.period_label?.trim()) patch.period_label = body.period_label.trim()
    if (body.cutoff_at) patch.cutoff_at = body.cutoff_at
    if (body.lock_at) patch.lock_at = body.lock_at
    if (body.scheduled_pay_date) patch.scheduled_pay_date = body.scheduled_pay_date

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // No edits (e.g. cutoff) while a lock is materializing against the old values.
    const { data: period, error } = await supabase
      .from('payroll_periods')
      .update(patch)
      .eq('id', periodId)
      .eq('org_id', orgId)
      .eq('status', 'open')
      .or(noLiveClaimFilter())
      .select(PERIOD_COLUMNS)
      .maybeSingle()

    if (error) return NextResponse.json({ error: 'Failed to update period' }, { status: 500 })
    if (!period) return periodBusyResponse('edit')
    return NextResponse.json({ period })
  } catch (e) {
    console.error('PATCH payroll period', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
