import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

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

    // Verify job exists and belongs to user's org
    const { data: existingJob, error: fetchError } = await adminClient
      .from('production_jobs')
      .select('id, org_id, project_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !existingJob) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()

    // Update the job
    const { data: updatedJob, error: updateError } = await adminClient
      .from('production_jobs')
      .update(body)
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

    const { data: job, error } = await adminClient
      .from('production_jobs')
      .select(`
        *,
        assigned_crew:crews(id, name, color, phone),
        assigned_sub:sub_contractors(id, company_name, contact_name, phone),
        customer:customers(id, name, phone, email),
        salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
        project:projects(id, scope_of_work, product_summary, ops_notes, payment_method, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
      `)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

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
