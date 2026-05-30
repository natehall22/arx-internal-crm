import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { isPayrollPeriodEditable, loadPayrollPeriodForOrg } from '@/lib/payroll-period-guards'
import {
  buildPayrollStatement,
  listRepIdsWithPeriodActivity,
  type PayrollStatementPayload,
} from '@/lib/payroll-statement'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST — recalculate estimated statements for an open period (no payout line writes).
 * Body: { user_id?: string }
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

    const periodId = params.periodId
    const supabase = createServiceClient()
    const orgId = profile.org_id

    const period = await loadPayrollPeriodForOrg(supabase, orgId, periodId)
    if (!period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }
    if (!isPayrollPeriodEditable(period)) {
      return NextResponse.json(
        {
          error:
            'Period is locked or paid. Preview recalculation is only available while the period is open.',
        },
        { status: 409 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as { user_id?: string }
    const targetUserId = body.user_id?.trim() || null

    const repIds = targetUserId
      ? [targetUserId]
      : await listRepIdsWithPeriodActivity(
          supabase,
          orgId,
          periodId,
          period.cutoff_at as string
        )

    if (targetUserId) {
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('id', targetUserId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
    }

    const statements: PayrollStatementPayload[] = []
    for (const userId of repIds) {
      const statement = await buildPayrollStatement(supabase, orgId, periodId, userId)
      if (statement) statements.push(statement)
    }

    if (targetUserId) {
      const one = statements[0]
      if (!one) {
        return NextResponse.json(
          { error: 'No statement could be built for this rep' },
          { status: 404 }
        )
      }
      return NextResponse.json(one)
    }

    return NextResponse.json({ statements })
  } catch (e) {
    console.error('POST payroll period preview', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
