import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { buildCommissionPayrollSnapshot } from '@/lib/commission-payroll'

/** Payroll-facing commission pool for a job (JSON for exports / integrations). */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const restricted =
      profile.role !== 'admin' && profile.role !== 'owner' && profile.role !== 'operations'
    if (restricted) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: job, error } = await adminClient
      .from('production_jobs')
      .select(
        'id, job_number, sale_amount, dealer_fee_amount, commission_pre_tax_subtotal, commission_comp_base'
      )
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const snapshot = buildCommissionPayrollSnapshot(job)

    return NextResponse.json({
      jobId: job.id,
      jobNumber: job.job_number,
      ...snapshot,
    })
  } catch (e) {
    console.error('GET /api/ops/jobs/[id]/commission-payroll', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
