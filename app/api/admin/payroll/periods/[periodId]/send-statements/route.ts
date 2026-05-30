import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { loadPayrollPeriodForOrg } from '@/lib/payroll-period-guards'
import {
  periodAllowsStatementEmailSend,
  sendPayrollStatementsForPeriod,
} from '@/lib/payroll-statement-send'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST — email pay statements to reps with payout lines or hours in this period.
 *
 * Body: { user_id?: string } — omit to send all eligible reps; set for single resend.
 *
 * Policy: only `locked` or `paid` periods (not `open`). Open-period watermarked
 * preview emails are not supported — use admin preview in-app instead.
 */
export async function POST(
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

    if (!process.env.SMTP_HOST) {
      return NextResponse.json({ error: 'SMTP is not configured' }, { status: 503 })
    }

    const periodId = params.periodId
    const supabase = createServiceClient()
    const orgId = profile.org_id

    const period = await loadPayrollPeriodForOrg(supabase, orgId, periodId)
    if (!period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }

    if (!periodAllowsStatementEmailSend(period.status)) {
      return NextResponse.json(
        {
          error:
            'Pay statements can only be emailed for locked or paid periods. Lock the period first; open-period preview emails are not sent.',
        },
        { status: 409 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as { user_id?: string }
    const userIds = body.user_id?.trim() ? [body.user_id.trim()] : undefined

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
      new URL(request.url).origin

    const result = await sendPayrollStatementsForPeriod({
      supabase,
      orgId,
      periodId,
      actorUserId: profile.id,
      appUrl,
      periodStatus: period.status,
      userIds,
    })

    return NextResponse.json({
      periodId,
      periodStatus: period.status,
      sentCount: result.sent.length,
      failedCount: result.failed.length,
      sent: result.sent,
      failed: result.failed,
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'PERIOD_NOT_SENDABLE') {
      return NextResponse.json({ error: 'Period is not eligible for statement email' }, { status: 409 })
    }
    console.error('POST send-statements', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
