import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { PAYROLL_PERIOD_COLUMNS as PERIOD_COLUMNS } from '@/lib/payroll-period-lock'

export const dynamic = 'force-dynamic'

type PeriodAction = 'lock' | 'mark_paid' | 'cancel' | 'reopen'

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
      // One lock path: "Pay this week → Approve" (POST /api/admin/payroll/pay-week/approve), which commits the week atomically
      // and only for the total the admin was shown. The old period API had no total to check against.
      return NextResponse.json({ error: 'Approve the week from Pay this week.', code: 'use_pay_this_week' }, { status: 410 })
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
