import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { loadPayrollPeriodForOrg } from '@/lib/payroll-period-guards'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET ?user_id= — override audit entries for a rep in this period.
 */
export async function GET(
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
    const userId = new URL(request.url).searchParams.get('user_id')
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    const period = await loadPayrollPeriodForOrg(supabase, orgId, periodId)
    if (!period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }

    const { data: roleJobs } = await supabase
      .from('deal_commission_roles')
      .select('job_id')
      .eq('org_id', orgId)
      .eq('user_id', userId)

    const jobIds = Array.from(new Set((roleJobs || []).map((r) => r.job_id as string)))

    const auditAppliesToUser = (row: Record<string, unknown>) => {
      const after = row.after_value as { user_id?: string } | null | undefined
      const before = row.before_value as { user_id?: string } | null | undefined
      if (after?.user_id === userId || before?.user_id === userId) return true
      return false
    }

    const [{ data: byPeriod }, { data: byJob }] = await Promise.all([
      supabase
        .from('payroll_override_audit')
        .select(
          'id, override_type, job_id, payroll_period_id, actor_user_id, reason, before_value, after_value, created_at, users:actor_user_id(full_name)'
        )
        .eq('org_id', orgId)
        .eq('payroll_period_id', periodId)
        .order('created_at', { ascending: false })
        .limit(100)
        .then((r) => ({
          data: (r.data || []).filter((row) => auditAppliesToUser(row as Record<string, unknown>)),
          error: r.error,
        })),
      jobIds.length > 0
        ? supabase
            .from('payroll_override_audit')
            .select(
              'id, override_type, job_id, payroll_period_id, actor_user_id, reason, before_value, after_value, created_at, users:actor_user_id(full_name)'
            )
            .eq('org_id', orgId)
            .in('job_id', jobIds)
            .is('payroll_period_id', null)
            .order('created_at', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ])

    const seen = new Set<string>()
    const merged = [...(byPeriod || []), ...(byJob || [])].filter((row) => {
      if (!auditAppliesToUser(row)) return false
      const id = row.id as string
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    merged.sort(
      (a, b) =>
        new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime()
    )

    const entries = merged.slice(0, 100).map((row) => {
      const actor = row.users as { full_name?: string } | null
      return {
        id: row.id,
        overrideType: row.override_type,
        jobId: row.job_id,
        payrollPeriodId: row.payroll_period_id,
        actorUserId: row.actor_user_id,
        actorName: actor?.full_name || row.actor_user_id,
        reason: row.reason,
        beforeValue: row.before_value,
        afterValue: row.after_value,
        createdAt: row.created_at,
      }
    })

    return NextResponse.json({ entries })
  } catch (e) {
    console.error('GET override-audit', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
