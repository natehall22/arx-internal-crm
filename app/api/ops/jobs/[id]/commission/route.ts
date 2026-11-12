import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canSeeFinancials } from '@/lib/financials-access'
import { loadJobCommissions } from '@/lib/job-commission-actual'

// GET - what payroll paid / computes as commission on this job (the job Financials card). Needs reports:financials.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const admin = createServiceClient()
    if (!(await canSeeFinancials(admin, profile))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { data: job } = await admin.from('production_jobs').select('id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const map = await loadJobCommissions(admin, profile.org_id, [params.id])
    return NextResponse.json({ commission: map.get(params.id) ?? null })
  } catch (error) {
    console.error('Error in GET /api/ops/jobs/[id]/commission:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
