import type { SupabaseClient } from '@supabase/supabase-js'

import { roundMoney } from '@/lib/money'
import { ensureNextOpenPeriod } from '@/lib/payroll-periods'

const LOCK_CLAIM_STALE_MS = 15 * 60 * 1000

/** A week can take or lose a fix only while it is open AND no approval is mid-flight (a live lock claim). */
function periodIsEditable(p: { status?: unknown; lock_claimed_at?: unknown }): boolean {
  if (p.status !== 'open') return false
  const claimed = p.lock_claimed_at ? new Date(String(p.lock_claimed_at)).getTime() : 0
  return !(claimed && Date.now() - claimed < LOCK_CLAIM_STALE_MS)
}

export type PayrollAdjustment = {
  id: string
  userId: string
  jobId: string | null
  amount: number
  reason: string
  kind: string
  periodId: string
}

/** Every live (not void) adjustment on a period. The one read, used by the screen, statements and CSV. */
export async function loadPeriodAdjustments(admin: SupabaseClient, orgId: string, periodId: string): Promise<PayrollAdjustment[]> {
  const { data, error } = await admin
    .from('payroll_adjustments')
    .select('id, user_id, job_id, amount, reason, kind, payroll_period_id, status')
    .eq('org_id', orgId)
    .eq('payroll_period_id', periodId)
    .neq('status', 'void')
    .order('created_at', { ascending: true })
  if (error) {
    // Before the migration the table does not exist: no adjustments, never a failed screen.
    if ((error as { code?: string }).code === '42P01' || /does not exist|schema cache/i.test(String(error.message))) return []
    throw error
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    jobId: (r.job_id as string | null) ?? null,
    amount: roundMoney(Number(r.amount) || 0),
    reason: r.reason as string,
    kind: r.kind as string,
    periodId: r.payroll_period_id as string,
  }))
}

export type AddAdjustmentResult = { ok: true; id: string; periodId: string; nextWeek: boolean } | { ok: false; status: number; error: string }

/**
 * "Fix a mistake". An OPEN week takes the line itself; a locked/paid week never changes, so the line goes on the next
 * open week (created if needed) and records which week it fixes.
 */
export async function addAdjustment(
  admin: SupabaseClient,
  input: { orgId: string; actorUserId: string; viewedPeriodId: string; userId: string; amount: number; reason: string; jobId?: string | null; kind?: string }
): Promise<AddAdjustmentResult> {
  const { orgId } = input
  const amount = roundMoney(input.amount)
  const reason = input.reason.trim().slice(0, 300)
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000) return { ok: false, status: 400, error: 'Enter an amount (not zero)' }
  if (!reason) return { ok: false, status: 400, error: 'Say why, in a few words' }

  const { data: period } = await admin.from('payroll_periods').select('id, status, cutoff_at, lock_claimed_at').eq('id', input.viewedPeriodId).eq('org_id', orgId).maybeSingle()
  if (!period) return { ok: false, status: 404, error: 'Week not found' }
  if (period.status === 'cancelled') return { ok: false, status: 409, error: 'That week was cancelled' }
  const { data: user } = await admin.from('users').select('id').eq('id', input.userId).eq('org_id', orgId).maybeSingle()
  if (!user) return { ok: false, status: 404, error: 'Person not found' }

  // Mid-approval (a live lock claim) the week is frozen: wait a moment rather than slip a line in under the lock.
  if (period.status === 'open' && !periodIsEditable(period)) return { ok: false, status: 409, error: 'This week is being approved right now. Try again in a minute.' }
  const open = period.status === 'open'
  const target = open ? { id: period.id as string } : await ensureNextOpenPeriod(admin, orgId, period.cutoff_at as string)
  const { data, error } = await admin
    .from('payroll_adjustments')
    .insert({
      org_id: orgId,
      payroll_period_id: target.id,
      user_id: input.userId,
      job_id: input.jobId ?? null,
      amount,
      reason,
      kind: input.kind ?? 'fix',
      status: 'pending',
      source_period_id: open ? null : (period.id as string),
      created_by: input.actorUserId,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('payroll adjustment insert', error)
    return { ok: false, status: 500, error: 'Could not save the fix' }
  }
  return { ok: true, id: data.id as string, periodId: target.id, nextWeek: !open }
}

/** Remove a fix that is still on an OPEN week. (Voided, not deleted: the history stays.) */
export async function voidAdjustment(admin: SupabaseClient, orgId: string, id: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: adj } = await admin.from('payroll_adjustments').select('id, payroll_period_id, status').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (!adj || adj.status === 'void') return { ok: false, status: 404, error: 'Fix not found' }
  const { data: period } = await admin.from('payroll_periods').select('status, lock_claimed_at').eq('id', adj.payroll_period_id as string).eq('org_id', orgId).maybeSingle()
  if (!period || !periodIsEditable(period)) return { ok: false, status: 409, error: 'That week is already approved (or being approved)' }
  const { error } = await admin.from('payroll_adjustments').update({ status: 'void' }).eq('id', id).eq('org_id', orgId).eq('status', 'pending')
  if (error) return { ok: false, status: 500, error: 'Could not remove the fix' }
  // Re-check: if an approval claimed the week between the read and the write, put the line back (the check was frozen).
  const { data: after } = await admin.from('payroll_periods').select('status, lock_claimed_at').eq('id', adj.payroll_period_id as string).eq('org_id', orgId).maybeSingle()
  if (!after || !periodIsEditable(after)) {
    await admin.from('payroll_adjustments').update({ status: 'pending' }).eq('id', id).eq('org_id', orgId).eq('status', 'void')
    return { ok: false, status: 409, error: 'That week is already approved (or being approved)' }
  }
  return { ok: true }
}
