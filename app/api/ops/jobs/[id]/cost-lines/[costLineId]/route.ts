import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

/**
 * Approve/un-approve a cost line for payroll deduction. Restricted to payroll admins
 * (admin/owner/operations) — approval is what makes a line commission-deductible via
 * derivePayrollEligibility (lib/payroll-period-materialization.ts).
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; costLineId: string } }
) {
  let profile
  let authUser
  try {
    const ctx = await requireAuthApi()
    profile = ctx.profile
    authUser = ctx.authUser
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isPayrollAdminRole(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const supabase = createServiceClient()
    const jobId = params.id
    const costLineId = params.costLineId

    const body = await request.json().catch(() => ({}))
    if (typeof body.approved !== 'boolean') {
      return NextResponse.json({ error: 'approved (boolean) is required' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('job_cost_lines')
      .select('id, job_id, org_id')
      .eq('id', costLineId)
      .eq('job_id', jobId)
      .eq('org_id', profile.org_id)
      .is('deleted_at', null)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'Cost line not found' }, { status: 404 })
    }

    const { data: row, error } = await supabase
      .from('job_cost_lines')
      .update({
        approved: body.approved,
        approved_by: body.approved ? authUser.id : null,
        approved_at: body.approved ? new Date().toISOString() : null,
      })
      .eq('id', costLineId)
      .eq('org_id', profile.org_id)
      .select('id, approved, approved_by, approved_at')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ cost_line: row })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
