import type { SupabaseClient } from '@supabase/supabase-js'
import { getMailTransport } from '@/lib/setter-email'
import { loadUsersForTransactionalEmail } from '@/lib/user-transactional-email'
import {
  computeStatementHash,
  payrollStatementEmailSubject,
  renderPayrollStatementEmailHtml,
  resolvePayrollStatementUrl,
} from '@/lib/payroll-statement-email'
import { buildPayrollStatement } from '@/lib/payroll-statement'

/** Only locked/paid periods — open-period preview emails are intentionally not supported. */
export const PAYROLL_STATEMENT_EMAIL_ALLOWED_STATUSES = ['locked', 'paid'] as const

export function periodAllowsStatementEmailSend(status: string): boolean {
  return PAYROLL_STATEMENT_EMAIL_ALLOWED_STATUSES.includes(
    status as (typeof PAYROLL_STATEMENT_EMAIL_ALLOWED_STATUSES)[number]
  )
}

export type StatementMailer = {
  send: (params: { to: string; subject: string; html: string }) => Promise<void>
}

export function defaultStatementMailer(): StatementMailer {
  const fromAddress = process.env.SMTP_FROM || 'ARX Roofing <noreply@arxroofing.com>'
  return {
    async send({ to, subject, html }) {
      if (!process.env.SMTP_HOST) {
        throw new Error('SMTP is not configured')
      }
      await getMailTransport().sendMail({
        from: fromAddress,
        to,
        subject,
        html,
      })
    },
  }
}

export type SendStatementFailure = {
  userId: string
  name: string
  reason: string
}

export type SendStatementSuccess = {
  userId: string
  name: string
  email: string
  statementHash: string
  deliveryId?: string
}

export type SendPayrollStatementsResult = {
  sent: SendStatementSuccess[]
  failed: SendStatementFailure[]
}

export async function listRepIdsWithPayoutOrHoursInPeriod(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string
): Promise<string[]> {
  const [{ data: lines }, { data: hours }] = await Promise.all([
    supabase
      .from('payroll_payout_lines')
      .select('user_id')
      .eq('payroll_period_id', periodId)
      .eq('org_id', orgId),
    supabase
      .from('payroll_rep_hours')
      .select('user_id')
      .eq('payroll_period_id', periodId)
      .eq('org_id', orgId),
  ])

  const repIds = new Set<string>()
  for (const row of lines || []) repIds.add(row.user_id as string)
  for (const row of hours || []) repIds.add(row.user_id as string)
  return Array.from(repIds)
}

async function logStatementDelivery(
  supabase: SupabaseClient,
  row: {
    orgId: string
    periodId: string
    userId: string
    actorUserId: string
    status: 'sent' | 'failed'
    errorMessage?: string | null
    statementHash?: string | null
  }
): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('payroll_statement_deliveries')
    .insert({
      org_id: row.orgId,
      payroll_period_id: row.periodId,
      user_id: row.userId,
      actor_user_id: row.actorUserId,
      status: row.status,
      error_message: row.errorMessage ?? null,
      statement_hash: row.statementHash ?? null,
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('payroll_statement_deliveries insert', error)
    return undefined
  }
  return data?.id as string | undefined
}

/**
 * Sends pay statement emails for a locked/paid period. Resend always allowed (new delivery row).
 * Recipient email: auth.users.email first, then public.users.email (admin user PATCH syncs both).
 */
export async function sendPayrollStatementsForPeriod(opts: {
  supabase: SupabaseClient
  orgId: string
  periodId: string
  actorUserId: string
  appUrl: string
  periodStatus: string
  userIds?: string[]
  mailer?: StatementMailer
}): Promise<SendPayrollStatementsResult> {
  const { supabase, orgId, periodId, actorUserId, appUrl, periodStatus } = opts
  const mailer = opts.mailer ?? defaultStatementMailer()

  if (!periodAllowsStatementEmailSend(periodStatus)) {
    throw new Error('PERIOD_NOT_SENDABLE')
  }

  const targetIds =
    opts.userIds?.length && opts.userIds.length > 0
      ? opts.userIds
      : await listRepIdsWithPayoutOrHoursInPeriod(supabase, orgId, periodId)

  const sent: SendStatementSuccess[] = []
  const failed: SendStatementFailure[] = []

  if (!targetIds.length) {
    return { sent, failed }
  }

  const userById = await loadUsersForTransactionalEmail(supabase, orgId, targetIds)
  const statementUrl = resolvePayrollStatementUrl(appUrl, periodId)

  for (const userId of targetIds) {
    const user = userById.get(userId)
    const name = user?.full_name || userId

    if (!user) {
      failed.push({ userId, name, reason: 'User not found in organization' })
      await logStatementDelivery(supabase, {
        orgId,
        periodId,
        userId,
        actorUserId,
        status: 'failed',
        errorMessage: 'User not found in organization',
      })
      continue
    }

    if (!user.active) {
      failed.push({ userId, name, reason: 'User is inactive' })
      await logStatementDelivery(supabase, {
        orgId,
        periodId,
        userId,
        actorUserId,
        status: 'failed',
        errorMessage: 'User is inactive',
      })
      continue
    }

    const email = user.resolvedEmail
    if (!email) {
      failed.push({ userId, name, reason: 'No email on file' })
      await logStatementDelivery(supabase, {
        orgId,
        periodId,
        userId,
        actorUserId,
        status: 'failed',
        errorMessage: 'No email on file',
      })
      continue
    }

    const statement = await buildPayrollStatement(supabase, orgId, periodId, userId)
    if (!statement) {
      failed.push({ userId, name, reason: 'Could not build statement' })
      await logStatementDelivery(supabase, {
        orgId,
        periodId,
        userId,
        actorUserId,
        status: 'failed',
        errorMessage: 'Could not build statement',
      })
      continue
    }

    const statementHash = computeStatementHash(statement)
    const subject = payrollStatementEmailSubject(statement)
    const html = renderPayrollStatementEmailHtml({ statement, statementUrl })

    try {
      await mailer.send({ to: email, subject, html })
      const deliveryId = await logStatementDelivery(supabase, {
        orgId,
        periodId,
        userId,
        actorUserId,
        status: 'sent',
        statementHash,
      })
      sent.push({ userId, name, email, statementHash, deliveryId })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Send failed'
      failed.push({ userId, name, reason: msg })
      await logStatementDelivery(supabase, {
        orgId,
        periodId,
        userId,
        actorUserId,
        status: 'failed',
        errorMessage: msg,
        statementHash,
      })
    }
  }

  return { sent, failed }
}
