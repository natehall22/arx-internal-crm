/**
 * One-tap approve (payroll phase 2). When a week is READY — ended, nothing needs the office, every number answered — each owner gets
 * "Approve $X for N people" by email (and an iPhone push when the app is installed) with a one-time link. The link opens a page that
 * shows the live week and ONE Approve button, which calls the same `approvePayWeek` as the Pay screen (owners only, checked from the
 * database; the total shown must equal the live total or nothing is paid).
 *
 * Re-authentication: there is no passkey / WebAuthn in this app yet (pre-launch list: add it and require it on this page). Until then
 * the link is a signed one-time secret AND the page requires the owner's own signed-in session: the link is bound to the owner it was
 * sent to (another signed-in user cannot use it), expires in 48 hours, dies when used, and only a SHA-256 of it is stored.
 */
import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getAppUrl } from '@/lib/app-url'
import { loadOrgForLinks } from '@/lib/company-links'
import { formatPayrollMoney } from '@/lib/payroll-format'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { loadPayWeek, type PayWeek } from '@/lib/payroll-pay-week'
import { sendPushToUser } from '@/lib/push-apns'
import { getCrmEmailFrom, getMailTransport, pickValidEmail } from '@/lib/setter-email'

export const APPROVAL_LINK_HOURS = 48

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Ready for a one-tap approval: still open, ended, something to pay, and NOTHING for a person to look at first. Pure. */
export function isCleanWeek(week: PayWeek, now: Date): boolean {
  if (week.state !== 'draft' || !week.canApprove || week.blockedBy || week.needs.length > 0) return false
  if (new Date(week.period.cutoffAt).getTime() > now.getTime()) return false
  if (week.totals.people === 0 || week.totals.amount <= 0) return false
  // A warning is something to look at, except a heads-up that is the same every week (another state's job).
  return week.warnings.every((w) => w.code === 'multi_state')
}

export type NewLink = { token: string; expiresAt: Date }

export async function createApprovalLink(admin: SupabaseClient, input: { orgId: string; periodId: string; userId: string; total: number; people: number; now?: Date }): Promise<NewLink | null> {
  const now = input.now ?? new Date()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + APPROVAL_LINK_HOURS * 3600_000)
  const { error } = await admin.from('payroll_approval_links').insert({
    org_id: input.orgId,
    payroll_period_id: input.periodId,
    user_id: input.userId,
    token_hash: hashToken(token),
    notified_total: input.total,
    notified_people: input.people,
    expires_at: expiresAt.toISOString(),
  })
  if (error) {
    // Before the migration the table is missing: nothing is sent.
    if ((error as { code?: string }).code !== '42P01') console.error('approval link insert', error)
    return null
  }
  return { token, expiresAt }
}

export type LinkRow = { id: string; org_id: string; payroll_period_id: string; user_id: string; notified_total: number; notified_people: number; expires_at: string; used_at: string | null }

/** The link for this token if it is unused and unexpired; null otherwise (one answer for wrong, used and expired alike). */
export async function findApprovalLink(admin: SupabaseClient, token: string, now: Date = new Date()): Promise<LinkRow | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
  const { data } = await admin.from('payroll_approval_links').select('id, org_id, payroll_period_id, user_id, notified_total, notified_people, expires_at, used_at').eq('token_hash', hashToken(token)).maybeSingle()
  const row = data as LinkRow | null
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= now.getTime()) return null
  return { ...row, notified_total: Number(row.notified_total), notified_people: Number(row.notified_people) }
}

/** Marks the link used exactly once; false if someone else just did. */
export async function consumeApprovalLink(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await admin.from('payroll_approval_links').update({ used_at: new Date().toISOString() }).eq('id', id).is('used_at', null).select('id')
  return (data ?? []).length === 1
}

export type NotifySummary = { sent: number; skipped: string | null }

/** Morning job: tell each owner a clean, ended week is ready. Once per owner per total (a changed total is a new message). */
export async function notifyPayWeekReady(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<NotifySummary> {
  if (!isPayWeekEnabled()) return { sent: 0, skipped: 'flag_off' }
  const week = await loadPayWeek(admin, orgId, now)
  if (!isCleanWeek(week, now)) return { sent: 0, skipped: 'not_clean' }
  const { data: owners } = await admin.from('users').select('id, full_name, email').eq('org_id', orgId).eq('is_super_admin', true).eq('active', true)
  const linkOrg = await loadOrgForLinks(orgId)
  let sent = 0
  for (const o of owners ?? []) {
    const { data: prior } = await admin.from('payroll_approval_links').select('id').eq('org_id', orgId).eq('payroll_period_id', week.period.id).eq('user_id', o.id as string).eq('notified_total', week.totals.amount).limit(1)
    if ((prior ?? []).length > 0) continue
    const link = await createApprovalLink(admin, { orgId, periodId: week.period.id, userId: o.id as string, total: week.totals.amount, people: week.totals.people, now })
    if (!link) continue
    const url = `${getAppUrl(linkOrg)}/payroll/approve/${link.token}`
    const title = `Approve ${formatPayrollMoney(week.totals.amount)} for ${week.totals.people} ${week.totals.people === 1 ? 'person' : 'people'}`
    const to = pickValidEmail(o.email as string | null)
    if (to && process.env.SMTP_HOST) {
      try {
        await getMailTransport().sendMail({
          from: getCrmEmailFrom(),
          to,
          subject: title,
          text: `${title}.\n\nThe week ending ${week.period.weekEnding} is ready: nothing needs you first. Payday is ${week.period.payDate}.\n\nOpen this, check the total, tap Approve:\n${url}\n\nThe link works once, for you, for ${APPROVAL_LINK_HOURS} hours.`,
        })
      } catch (e) {
        console.error('pay-week ready email failed', e)
      }
    }
    await sendPushToUser(o.id as string, title, `Week ending ${week.period.weekEnding} is ready. Tap to approve.`, { type: 'pay_week_ready', url })
    sent += 1
  }
  return { sent, skipped: null }
}
