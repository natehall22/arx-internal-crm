import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { importProjectReviewNoteToJob } from '@/lib/project-review'

function sanitizeJobsForRole(jobs: any[], role: string) {
  if (role === 'admin') return jobs

  return jobs.map((job) => {
    const { labor_cost, material_cost, ...safeJob } = job
    return safeJob
  })
}

// POST - Create a production job from a project
export async function POST(request: Request) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Check role access
    if (!['admin', 'regional_manager', 'operations', 'manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { project_id, sale_amount } = body

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
    }

    // Get the project
    const { data: project, error: projectError } = await adminClient
      .from('projects')
      .select('*, customers(id, name)')
      .eq('id', project_id)
      .eq('org_id', profile.org_id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check if production job already exists for this project
    const { data: existingJob } = await adminClient
      .from('production_jobs')
      .select('id, job_number')
      .eq('project_id', project_id)
      .single()

    if (existingJob) {
      return NextResponse.json({ 
        error: 'Production job already exists for this project',
        job_id: existingJob.id,
        job_number: existingJob.job_number
      }, { status: 409 })
    }

    // Create the production job
    const { data: newJob, error: createError } = await adminClient
      .from('production_jobs')
      .insert({
        org_id: profile.org_id,
        project_id: project.id,
        customer_id: project.customer_id,
        job_type: project.project_type || 'roofing',
        address_text: project.address_text || '',
        lat: project.lat,
        lng: project.lng,
        salesperson_id: project.owner_user_id,
        sale_date: new Date().toISOString().split('T')[0],
        sale_amount: sale_amount || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating production job:', createError)
      return NextResponse.json({ error: 'Failed to create production job' }, { status: 500 })
    }

    const importResult = await importProjectReviewNoteToJob(adminClient, {
      jobId: newJob.id,
      projectId: project_id,
      actorUserId: user.id,
    })
    if (!importResult.ok) {
      console.warn('Project review → job note import:', importResult.error)
    }

    // Optionally update project status
    await adminClient
      .from('projects')
      .update({ status: 'in_progress' })
      .eq('id', project_id)

    // Create activity log
    await adminClient.from('activities').insert({
      org_id: profile.org_id,
      project_id: project_id,
      user_id: user.id,
      type: 'status_change',
      body: `Project sent to Operations as Job ${newJob.job_number}`,
    })

    return NextResponse.json({ 
      success: true, 
      job: newJob,
      message: `Production job ${newJob.job_number} created successfully`
    })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET - List production jobs
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const crew_id = searchParams.get('crew_id')
    const date_from = searchParams.get('date_from')
    const date_to = searchParams.get('date_to')

    let query = adminClient
      .from('production_jobs')
      .select(`
        *,
        assigned_crew:crews(id, name, color),
        assigned_sub:sub_contractors(id, company_name),
        customer:customers(id, name, phone),
        salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
        project:projects(id, scope_of_work, product_summary, ops_notes, project_review)
      `)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (crew_id) {
      query = query.eq('assigned_crew_id', crew_id)
    }

    if (date_from) {
      query = query.gte('scheduled_date', date_from)
    }

    if (date_to) {
      query = query.lte('scheduled_date', date_to)
    }

    const { data: jobs, error } = await query

    if (error) {
      console.error('Error fetching jobs:', error)
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
    }

    return NextResponse.json({ jobs: sanitizeJobsForRole(jobs || [], profile.role) })

  } catch (error) {
    console.error('Error in GET /api/ops/jobs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
