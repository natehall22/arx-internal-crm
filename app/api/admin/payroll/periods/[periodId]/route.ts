import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { materializePayrollPeriod } from '@/lib/payroll-period-materialization'

export const dynamic = 'force-dynamic'

type PeriodAction = 'lock' | 'mark_paid' | 'cancel' | 'reopen'

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

      const { error: updErr } = await supabase
        .from('payroll_periods')
        .update({ status: 'locked', locked_at: now })
        .eq('id', periodId)
        .eq('org_id', orgId)

      if (updErr) {
        console.error('period lock', updErr)
        return NextResponse.json({ error: 'Failed to lock period' }, { status: 500 })
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
        return NextResponse.json(
          {
            error: `Lock rolled back: ${postLockPending} bonus line(s) became pending during lock. Review and retry.`,
          },
          { status: 409 }
        )
      }

      const { data: period } = await supabase
        .from('payroll_periods')
        .select(
          'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'
        )
        .eq('id', periodId)
        .single()

      return NextResponse.json({
        period,
        materialization,
        message: `Period locked with ${materialization.payoutLinesCreated} payout line(s).`,
      })
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
        .select(
          'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'
        )
        .single()
      if (error) return NextResponse.json({ error: 'Failed to mark paid' }, { status: 500 })
      return NextResponse.json({ period })
    }

    if (body.action === 'cancel') {
      const { data: period, error } = await supabase
        .from('payroll_periods')
        .update({ status: 'cancelled' })
        .eq('id', periodId)
        .eq('org_id', orgId)
        .select(
          'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'
        )
        .single()
      if (error) return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
      return NextResponse.json({ period })
    }

    if (body.action === 'reopen') {
      const { data: period, error } = await supabase
        .from('payroll_periods')
        .update({ status: 'open', locked_at: null, paid_at: null })
        .eq('id', periodId)
        .eq('org_id', orgId)
        .select(
          'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'
        )
        .single()
      if (error) return NextResponse.json({ error: 'Failed to reopen' }, { status: 500 })
      return NextResponse.json({ period })
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

    const { data: period, error } = await supabase
      .from('payroll_periods')
      .update(patch)
      .eq('id', periodId)
      .eq('org_id', orgId)
      .select(
        'id, period_label, cutoff_at, lock_at, scheduled_pay_date, status, locked_at, paid_at, created_at'
      )
      .single()

    if (error) return NextResponse.json({ error: 'Failed to update period' }, { status: 500 })
    return NextResponse.json({ period })
  } catch (e) {
    console.error('PATCH payroll period', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
