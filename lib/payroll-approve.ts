import type { SupabaseClient } from '@supabase/supabase-js'

import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { buildPayrollStatement } from '@/lib/payroll-statement'
import { sendPayrollStatementEmail } from '@/lib/payroll-statement-email'
import { pickValidEmail } from '@/lib/setter-email'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'
import { weeklyPayrollPayDateForCutoff } from '@/lib/weekly-payroll/cutoff'

/**
 * Bonuses nobody approved this week wait: they move to NEXT week's period (created if needed) so they show up in its
 * "Needs you". A bonus that would collide with an existing one there (unique per period/user/type) stays put.
 */
export async function rollPendingBonusesForward(
  admin: SupabaseClient,
  orgId: string,
  period: { id: string; cutoffAt: string }
): Promise<{ moved: number }> {
  const { data: pending } = await admin.from('payroll_bonus_lines').select('id').eq('org_id', orgId).eq('payroll_period_id', period.id).eq('status', 'pending_approval')
  if (!pending?.length) return { moved: 0 }

  const nextCutoff = new Date(new Date(period.cutoffAt).getTime() + 7 * 86_400_000)
  const from = new Date(nextCutoff.getTime() - 36 * 3_600_000).toISOString()
  const to = new Date(nextCutoff.getTime() + 36 * 3_600_000).toISOString()
  const find = async () => {
    const { data } = await admin.from('payroll_periods').select('id').eq('org_id', orgId).eq('status', 'open').gte('cutoff_at', from).lte('cutoff_at', to).order('created_at', { ascending: true }).limit(1)
    return (data ?? [])[0] as { id: string } | undefined
  }
  let next = await find()
  if (!next) {
    const { error } = await admin.from('payroll_periods').insert({
      org_id: orgId,
      period_label: `Week ending ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(nextCutoff)}`,
      cutoff_at: nextCutoff.toISOString(),
      lock_at: nextCutoff.toISOString(),
      scheduled_pay_date: weeklyPayrollPayDateForCutoff(nextCutoff),
      status: 'open',
    })
    if (error) throw error
    next = await find()
  }
  if (!next) return { moved: 0 }

  let moved = 0
  for (const line of pending) {
    const { error } = await admin.from('payroll_bonus_lines').update({ payroll_period_id: next.id }).eq('id', line.id as string).eq('status', 'pending_approval')
    if (!error) moved += 1
  }
  return { moved }
}

export type EmailSummary = { sent: number; skipped: number; failed: number }

/** Best-effort: one statement email per paid person. Never throws — payroll is already approved by now. */
export async function emailStatements(admin: SupabaseClient, orgId: string, periodId: string, userIds: string[]): Promise<EmailSummary> {
  const out: EmailSummary = { sent: 0, skipped: 0, failed: 0 }
  if (!process.env.SMTP_HOST) return { sent: 0, skipped: userIds.length, failed: 0 }
  for (const userId of userIds) {
    try {
      const { data: user } = await admin.from('users').select('id, full_name, email').eq('id', userId).eq('org_id', orgId).maybeSingle()
      const to = pickValidEmail(user?.email)
      if (!user || !to || !(await isUserActiveForTransactionalEmail(admin, userId))) {
        out.skipped += 1
        continue
      }
      const statement = await buildPayrollStatement(admin, orgId, periodId, userId)
      if (!statement) {
        out.skipped += 1
        continue
      }
      await sendPayrollStatementEmail({ to, recipientName: (user.full_name as string) || 'there', recipientUserId: userId, statement, attachPdf: true })
      out.sent += 1
    } catch (e) {
      console.error('pay-week: statement email failed', userId, e)
      out.failed += 1
    }
  }
  return out
}

export type ApproveResult =
  | { ok: true; total: number; people: number; mismatch: boolean; emailed: EmailSummary | null; message: string }
  | { ok: false; status: number; body: { error: string; code?: string; total?: number } }

/**
 * Approve a week. The caller passes the total it was SHOWN; if the live calculation no longer equals it, nothing is
 * paid ("changed"). Otherwise unapproved bonuses roll to next week and the period is locked by `lockPayrollPeriod`
 * (which runs the same calculation the preview did). One function so the route and its tests exercise the same path.
 */
export async function approvePayWeek(
  admin: SupabaseClient,
  input: { orgId: string; actorUserId: string; periodId: string; expectedTotal: number; emailStatements: boolean; now?: Date }
): Promise<ApproveResult> {
  const { orgId, periodId } = input
  const now = input.now ?? new Date()
  const week = await loadPayWeek(admin, orgId, now, periodId)
  if (week.state !== 'draft') return { ok: false, status: 409, body: { error: 'This week is already approved' } }
  if (Math.round(week.totals.amount * 100) !== Math.round(input.expectedTotal * 100)) {
    return { ok: false, status: 409, body: { error: 'The numbers changed while you were looking. Review them again.', code: 'changed', total: week.totals.amount } }
  }
  if (week.totals.amount <= 0) return { ok: false, status: 409, body: { error: 'Nothing to pay this week' } }

  await rollPendingBonusesForward(admin, orgId, week.period)
  const lock = await lockPayrollPeriod(admin, { orgId, periodId, actorUserId: input.actorUserId, status: 'open', requireNoPendingBonuses: false })
  if (!lock.ok) return { ok: false, status: lock.status, body: lock.body }

  // Safety net: what was written must equal what was approved. The lines are already frozen, so just say so loudly.
  const after = await loadPayWeek(admin, orgId, now, periodId)
  const mismatch = Math.round(after.totals.amount * 100) !== Math.round(week.totals.amount * 100)
  if (mismatch) console.error('pay-week approve: written total differs from approved total', { periodId, approved: week.totals.amount, written: after.totals.amount })
  const emailed = input.emailStatements ? await emailStatements(admin, orgId, periodId, after.people.filter((p) => p.total > 0).map((p) => p.userId)) : null
  return { ok: true, total: after.totals.amount, people: after.totals.people, mismatch, emailed, message: lock.message }
}
