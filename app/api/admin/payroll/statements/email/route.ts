import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { buildPayrollStatement } from '@/lib/payroll-statement'
import { sendPayrollStatementEmail } from '@/lib/payroll-statement-email'
import { pickValidEmail } from '@/lib/setter-email'
import { isUserActiveForTransactionalEmail } from '@/lib/user-email-eligibility'

export const dynamic = 'force-dynamic'

const SENDABLE_PERIOD_STATUSES = new Set(['locked', 'paid'])

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as {
      period_id?: string
      user_id?: string
      attach_pdf?: boolean
    }
    const periodId = body.period_id
    const userId = body.user_id
    if (!periodId || !userId) {
      return NextResponse.json({ error: 'period_id and user_id are required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    const { data: period, error: periodErr } = await supabase
      .from('payroll_periods')
      .select('id, period_label, status')
      .eq('id', periodId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (periodErr || !period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }
    if (!SENDABLE_PERIOD_STATUSES.has(String(period.status))) {
      return NextResponse.json(
        { error: 'Pay statement can only be emailed after the period is locked or marked paid' },
        { status: 409 }
      )
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, full_name, email, active')
      .eq('id', userId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (userErr || !user) {
      return NextResponse.json({ error: 'Consultant not found' }, { status: 404 })
    }

    const to = pickValidEmail(user.email)
    if (!to) {
      return NextResponse.json(
        { error: 'This consultant has no valid email on file. Add an email on their user profile first.' },
        { status: 400 }
      )
    }

    if (!(await isUserActiveForTransactionalEmail(supabase, userId))) {
      return NextResponse.json(
        { error: 'This consultant account is inactive and cannot receive email.' },
        { status: 400 }
      )
    }

    const statement = await buildPayrollStatement(supabase, orgId, periodId, userId)
    if (!statement) {
      return NextResponse.json({ error: 'Could not build pay statement' }, { status: 404 })
    }

    const { statementUrl, pdfAttached } = await sendPayrollStatementEmail({
      to,
      recipientName: (user.full_name as string) || 'Consultant',
      recipientUserId: userId,
      statement,
      attachPdf: body.attach_pdf !== false,
    })

    return NextResponse.json({
      success: true,
      sent_to: to,
      period_id: periodId,
      user_id: userId,
      statement_url: statementUrl,
      pdf_attached: pdfAttached,
    })
  } catch (e) {
    console.error('POST admin/payroll/statements/email', e)
    return NextResponse.json({ error: 'Failed to send pay statement email' }, { status: 500 })
  }
}
