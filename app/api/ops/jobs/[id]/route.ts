import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getJobPaymentSummary } from '@/lib/job-payments'
import { canAccessJobBoard } from '@/lib/permissions'

const jobSelectWithPaymentMethod = `
  *,
  assigned_crew:crews(id, name, color, phone),
  assigned_sub:sub_contractors(id, company_name, contact_name, phone),
  customer:customers(id, name, phone, email),
  salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
  project:projects(id, scope_of_work, product_summary, ops_notes, permits_status, install_date, project_review, payment_method, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
`

const jobSelectWithoutPaymentMethod = `
  *,
  assigned_crew:crews(id, name, color, phone),
  assigned_sub:sub_contractors(id, company_name, contact_name, phone),
  customer:customers(id, name, phone, email),
  salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
  project:projects(id, scope_of_work, product_summary, ops_notes, permits_status, install_date, project_review, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
`

function mapJobStatusToProjectStatus(jobStatus: string) {
  if (jobStatus === 'collected') return 'collected'
  if (jobStatus === 'complete') return 'complete'
  if (jobStatus === 'on_hold') return 'on_hold'
  return 'in_progress'
}

// PATCH - Update a production job
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
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

    if (!canAccessJobBoard(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify job exists and belongs to user's org (do not select payroll_sent_at here — if migration
    // 124 is not applied, referencing that column makes the whole query fail with a false "not found".)
    const { data: existingJob, error: fetchError } = await adminClient
      .from('production_jobs')
      .select('id, org_id, project_id, status')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !existingJob) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()

    // Whitelist updateable fields to prevent mass-assignment
    const ALLOWED_FIELDS = new Set([
      'status', 'materials_status', 'materials_ordered_at',
      'started_at', 'completed_at', 'scheduled_date',
      'scheduled_time_start', 'estimated_duration_hours',
      'assigned_crew_id', 'assigned_sub_id',
      'labor_cost', 'internal_notes',
      'deposit_required_percent', 'finance_submitted_at',
      'allow_close_with_balance', 'close_balance_reason',
      // Insurance / job source (migration 099)
      'job_source', 'insurance_stage',
      'acv_amount', 'depreciation_amount', 'supplement_amount',
      'claim_number', 'insurance_company',
      'payroll_sent_at',
    ])
    const updateData: Record<string, unknown> = {}
    for (const key of Object.keys(body)) {
      if (ALLOWED_FIELDS.has(key)) updateData[key] = body[key]
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    if (updateData.payroll_sent_at !== undefined) {
      const ts = updateData.payroll_sent_at
      if (ts !== null && typeof ts === 'string') {
        if (!['complete', 'collected'].includes(String(existingJob.status))) {
          return NextResponse.json(
            { error: 'Mark the job complete or collected before sending to payroll' },
            { status: 400 }
          )
        }
        const { data: payrollRow, error: payrollFetchError } = await adminClient
          .from('production_jobs')
          .select('payroll_sent_at')
          .eq('id', params.id)
          .eq('org_id', profile.org_id)
          .maybeSingle()
        if (payrollFetchError) {
          console.error('payroll_sent_at column missing or unreadable:', payrollFetchError)
          return NextResponse.json(
            {
              error:
                'Payroll tracking is not available until database migration 124 is applied (production_jobs.payroll_sent_at).',
            },
            { status: 503 }
          )
        }
        if (payrollRow?.payroll_sent_at) {
          return NextResponse.json({ error: 'Already marked sent to payroll' }, { status: 400 })
        }
      }
    }

    // Fail-safe: "collected" is the closed-out state (Completed tab). Do not allow it until
    // recorded payments cover the sale amount (same rule as the job detail auto-collect effect).
    if (updateData.status === 'collected') {
      const summary = await getJobPaymentSummary(adminClient, params.id)
      if (!summary) {
        return NextResponse.json({ error: 'Could not verify payments for this job' }, { status: 400 })
      }
      const { sale_amount_cents: saleCents, collected_cents: collected } = summary
      if (saleCents > 0 && collected < saleCents) {
        return NextResponse.json(
          {
            error: 'Cannot mark as collected until the job is fully paid',
            remaining_cents: saleCents - collected,
          },
          { status: 400 }
        )
      }
    }

    // Update the job
    const { data: updatedJob, error: updateError } = await adminClient
      .from('production_jobs')
      .update(updateData)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating job:', updateError)
      return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
    }

    // Keep linked project status aligned with job lifecycle status.
    if (updatedJob?.project_id && updatedJob?.status) {
      const mappedProjectStatus = mapJobStatusToProjectStatus(updatedJob.status)
      const { error: projectStatusError } = await adminClient
        .from('projects')
        .update({ status: mappedProjectStatus })
        .eq('id', updatedJob.project_id)
        .eq('org_id', profile.org_id)

      if (projectStatusError) {
        console.error('Error syncing project status from job:', projectStatusError)
      }
    }

    return NextResponse.json({ success: true, job: updatedJob })

  } catch (error) {
    console.error('Error in PATCH /api/ops/jobs/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET - Get a single production job
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
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

    const jobResWithPaymentMethod = await adminClient
      .from('production_jobs')
      .select(jobSelectWithPaymentMethod)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    const shouldFallbackToLegacyProjectShape = !!jobResWithPaymentMethod.error

    const jobRes = shouldFallbackToLegacyProjectShape
      ? await adminClient
          .from('production_jobs')
          .select(jobSelectWithoutPaymentMethod)
          .eq('id', params.id)
          .eq('org_id', profile.org_id)
          .single()
      : jobResWithPaymentMethod

    const job = jobRes.data
    const error = jobRes.error

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ job })

  } catch (error) {
    console.error('Error in GET /api/ops/jobs/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a production job
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
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

    // Only admins can delete jobs
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete jobs' }, { status: 403 })
    }

    // Verify job exists and belongs to user's org
    const { data: existingJob, error: fetchError } = await adminClient
      .from('production_jobs')
      .select('id, org_id, job_number')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !existingJob) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Delete the job
    const { error: deleteError } = await adminClient
      .from('production_jobs')
      .delete()
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Error deleting job:', deleteError)
      return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: `Job ${existingJob.job_number} deleted` })

  } catch (error) {
    console.error('Error in DELETE /api/ops/jobs/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
