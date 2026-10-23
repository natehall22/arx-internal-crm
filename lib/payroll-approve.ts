import type { SupabaseClient } from '@supabase/supabase-js'

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
