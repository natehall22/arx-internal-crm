import type { SupabaseClient } from '@supabase/supabase-js'

import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { loadPayWeek } from '@/lib/payroll-pay-week'
import { buildPayrollStatement } from '@/lib/payroll-statement'
import { sendPayrollStatementEmail } from '@/lib/payroll-statement-email'
import { pickValidEmail } from '@/lib/setter-email'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'

export type ApproveResult =
  | { ok: true; total: number; people: number; /** The written total differs from the approved one (a read raced a write): the screen must say so. */ mismatch: boolean; writtenTotal: number; message: string }
  | { ok: false; status: number; body: { error: string; code?: string; total?: number } }

/**
 * Approve a week. The caller passes the total it was SHOWN; if the live calculation no longer equals it, nothing is paid
 * ("changed"). Otherwise the period is locked by `lockPayrollPeriod`, which runs the same calculation the preview did.
 * Unapproved bonuses are left where they are: they show up in the next open week's "Needs you" (see loadPayWeek), so
 * nothing is moved before the lock succeeds and nothing can collide. Statements are emailed separately (`emailWeekStatements`).
 */
export async function approvePayWeek(
  admin: SupabaseClient,
  input: { orgId: string; actorUserId: string; periodId: string; expectedTotal: number; now?: Date }
): Promise<ApproveResult> {
  const { orgId, periodId } = input
  const now = input.now ?? new Date()
  const week = await loadPayWeek(admin, orgId, now, periodId)
  if (week.state !== 'draft') return { ok: false, status: 409, body: { error: 'This week is already approved' } }
  // A week can only be approved once it has ended (its Wednesday cutoff has passed): never the upcoming week.
  if (new Date(week.period.cutoffAt).getTime() > now.getTime()) {
    return { ok: false, status: 409, body: { error: "This week hasn't ended yet. Approve it after Wednesday night.", code: 'not_ended' } }
  }
  if (Math.round(week.totals.amount * 100) !== Math.round(input.expectedTotal * 100)) {
    return { ok: false, status: 409, body: { error: 'The numbers changed while you were looking. Review them again.', code: 'changed', total: week.totals.amount } }
  }
  if (week.totals.amount <= 0) return { ok: false, status: 409, body: { error: 'Nothing to pay this week' } }

  const lock = await lockPayrollPeriod(admin, { orgId, periodId, actorUserId: input.actorUserId, status: 'open', requireNoPendingBonuses: false })
  if (!lock.ok) return { ok: false, status: lock.status, body: lock.body }

  // Safety net: what was written must equal what was approved. The lines are already frozen, so report it, loudly.
  const after = await loadPayWeek(admin, orgId, now, periodId)
  const mismatch = Math.round(after.totals.amount * 100) !== Math.round(week.totals.amount * 100)
  if (mismatch) console.error('pay-week approve: written total differs from approved total', { periodId, approved: week.totals.amount, written: after.totals.amount })
  return { ok: true, total: week.totals.amount, people: after.totals.people, mismatch, writtenTotal: after.totals.amount, message: lock.message }
}

export type EmailSummary = { sent: number; skipped: number; failed: number; reason?: string }

/** One statement email per paid person for an approved week. Safe to run again (it is how a failed send is retried). */
export async function emailWeekStatements(admin: SupabaseClient, orgId: string, periodId: string): Promise<EmailSummary | { error: string; status: number }> {
  const { data: period } = await admin.from('payroll_periods').select('status').eq('id', periodId).eq('org_id', orgId).maybeSingle()
  if (!period) return { error: 'Week not found', status: 404 }
  if (period.status !== 'locked' && period.status !== 'paid') return { error: 'Approve the week first', status: 409 }
  if (!process.env.SMTP_HOST) return { error: 'Email is not set up on this server (SMTP). Nothing was sent.', status: 503 }

  const week = await loadPayWeek(admin, orgId, new Date(), periodId)
  const out: EmailSummary = { sent: 0, skipped: 0, failed: 0 }
  for (const p of week.people.filter((x) => x.total > 0)) {
    try {
      const { data: user } = await admin.from('users').select('id, full_name, email').eq('id', p.userId).eq('org_id', orgId).maybeSingle()
      const to = pickValidEmail(user?.email)
      if (!user || !to || !(await isUserActiveForTransactionalEmail(admin, p.userId))) {
        out.skipped += 1
        continue
      }
      const statement = await buildPayrollStatement(admin, orgId, periodId, p.userId)
      if (!statement) {
        out.skipped += 1
        continue
      }
      await sendPayrollStatementEmail({ to, recipientName: (user.full_name as string) || 'there', recipientUserId: p.userId, statement, attachPdf: true })
      out.sent += 1
    } catch (e) {
      console.error('pay-week: statement email failed', p.userId, e)
      out.failed += 1
    }
  }
  return out
}
