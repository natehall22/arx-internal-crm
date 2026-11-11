import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOrgForLinks } from '@/lib/company-links'

import { lockPayrollPeriod } from '@/lib/payroll-period-lock'
import { WEEKDAY_NAMES, weekdayOfYmd } from '@/lib/payroll-week-schedule'
import { loadPayWeek, resolvePayWeekPeriod, type PayWeek } from '@/lib/payroll-pay-week'
import { buildPayrollStatement } from '@/lib/payroll-statement'
import { sendPayrollStatementEmail } from '@/lib/payroll-statement-email'
import { getOrgBrand } from '@/lib/org-brand'
import { isSuperAdmin } from '@/lib/super-admin'
import { pickValidEmail } from '@/lib/setter-email'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'

/** What anyone but an owner sees on Approve. */
export const OWNER_ONLY_APPROVE_MESSAGE = 'Only an owner can approve payroll. Everything else on this screen is ready for them.'

export type ApproveResult =
  | { ok: true; total: number; people: number; message: string }
  | { ok: false; status: number; body: { error: string; code?: string; total?: number } }

/**
 * Approve a week. The caller passes the total it was SHOWN; if the live calculation no longer equals it, nothing is paid
 * ("changed"). Otherwise `lockPayrollPeriod` commits the whole week in ONE database transaction (claim -> compute -> validate
 * -> snapshots/lines/state/per-unit pay -> carry negative balances -> lock): either all of it is written, to the cent of the
 * approved total, or none of it is. Unapproved bonuses are left where they are: they show up in the next open week's
 * "Needs you" (see loadPayWeek). Statements are emailed separately (`emailWeekStatements`), only after a successful lock.
 */
export async function approvePayWeek(
  admin: SupabaseClient,
  input: { orgId: string; actorUserId: string; periodId: string; expectedTotal: number; now?: Date }
): Promise<ApproveResult> {
  const { orgId, periodId } = input
  const now = input.now ?? new Date()
  // Only an owner (super admin) approves; the office prepares everything else. Checked here, from the database, for every caller.
  const { data: actor, error: actorErr } = await admin.from('users').select('id, is_super_admin, active').eq('id', input.actorUserId).eq('org_id', orgId).maybeSingle()
  if (actorErr) throw actorErr
  if (!isSuperAdmin(actor as never)) return { ok: false, status: 403, body: { error: OWNER_ONLY_APPROVE_MESSAGE, code: 'owner_only' } }
  // Cheap early exits from the period row alone; the pay calculation runs ONCE, under the claim, inside lockPayrollPeriod
  // (which also refuses when its total is not the one the admin was shown).
  const period = await resolvePayWeekPeriod(admin, orgId, now, periodId)
  if (period.status !== 'open') return { ok: false, status: 409, body: { error: 'This week is already approved' } }
  // A week can only be approved once it has ended (its cutoff has passed): never the upcoming week.
  if (new Date(period.cutoffAt).getTime() > now.getTime()) {
    return { ok: false, status: 409, body: { error: `This week hasn't ended yet. Approve it after ${WEEKDAY_NAMES[weekdayOfYmd(period.weekEnding)]} night.`, code: 'not_ended' } }
  }

  const lock = await lockPayrollPeriod(admin, { orgId, periodId, actorUserId: input.actorUserId, status: 'open', expectedTotal: input.expectedTotal, now })
  if (!lock.ok) return { ok: false, status: lock.status, body: lock.body }
  // What is reported is what the database wrote (the commit refuses unless it equals the approved total), never the preview.
  return { ok: true, total: lock.summary.total, people: lock.summary.people, message: lock.message }
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
  const brand = await getOrgBrand(admin, orgId)
  const linkOrg = await loadOrgForLinks(orgId)
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
      await sendPayrollStatementEmail({ to, recipientName: (user.full_name as string) || 'there', recipientUserId: p.userId, statement, brand, linkOrg, attachPdf: true })
      out.sent += 1
    } catch (e) {
      console.error('pay-week: statement email failed', p.userId, e)
      out.failed += 1
    }
  }
  return out
}
