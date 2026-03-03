import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuth()
    const supabase = createClient()

    // Get sub_id for this user
    const { data: subId } = await supabase
      .rpc('get_sub_id_for_user', { user_uuid: profile.id })

    if (!subId) {
      return NextResponse.json({ error: 'Not a sub contractor' }, { status: 403 })
    }

    // Fetch job detail - only if assigned to this sub
    const { data: job, error: jobError } = await supabase
      .from('production_jobs')
      .select(`
        id,
        job_number,
        job_type,
        status,
        address_text,
        scheduled_date,
        scheduled_time_start,
        scheduled_time_end,
        estimated_duration_hours,
        permit_required,
        permit_number,
        permit_status,
        special_instructions,
        job_packet_pdf_path,
        project_id,
        customer:customers(name, phone, email),
        project:projects(scope_of_work, product_summary)
      `)
      .eq('id', params.id)
      .eq('assigned_sub_id', subId)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found or not assigned to you' }, { status: 404 })
    }

    // Fetch accepted proposal line items
    let lineItems: any[] = []
    if (job.project_id) {
      const { data: proposals } = await supabase
        .from('proposals')
        .select('id, scope_of_work')
        .eq('project_id', job.project_id)
        .not('accepted_at', 'is', null)
        .limit(1)

      if (proposals && proposals.length > 0) {
        const { data: items } = await supabase
          .from('proposal_line_items')
          .select('id, name, description, category, quantity, unit')
          .eq('proposal_id', proposals[0].id)
          .order('sort_order')
        lineItems = items || []
      }
    }

    // Fetch shared notes
    const { data: notes } = await supabase
      .from('production_job_notes')
      .select('id, note, created_at')
      .eq('job_id', params.id)
      .eq('share_with_sub', true)
      .order('created_at', { ascending: false })
      .limit(10)

    // Fetch shared files and final photos
    const { data: files } = await supabase
      .from('files')
      .select('id, file_name, storage_path, photo_tag, mime_type, created_at')
      .or(`job_id.eq.${params.id},project_id.eq.${job.project_id}`)
      .or('share_with_sub.eq.true,photo_tag.like.final_%')
      .order('created_at', { ascending: false })

    // Transform the data
    const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
    const project = Array.isArray(job.project) ? job.project[0] : job.project

    const jobDetail = {
      id: job.id,
      job_number: job.job_number,
      job_type: job.job_type,
      status: job.status,
      address_text: job.address_text,
      scheduled_date: job.scheduled_date,
      scheduled_time_start: job.scheduled_time_start,
      scheduled_time_end: job.scheduled_time_end,
      estimated_duration_hours: job.estimated_duration_hours,
      permit_required: job.permit_required,
      permit_number: job.permit_number,
      permit_status: job.permit_status,
      special_instructions: job.special_instructions,
      job_packet_pdf_path: job.job_packet_pdf_path,
      customer_name: customer?.name,
      customer_phone: customer?.phone,
      scope_of_work: project?.scope_of_work,
      product_summary: project?.product_summary,
      line_items: lineItems,
      notes: notes || [],
      files: files || [],
    }

    return NextResponse.json({ job: jobDetail })

  } catch (error) {
    console.error('Error in sub job detail API:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// Allow sub to update job status (start/complete)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuth()
    const supabase = createClient()
    const body = await request.json()

    // Get sub_id for this user
    const { data: subId } = await supabase
      .rpc('get_sub_id_for_user', { user_uuid: profile.id })

    if (!subId) {
      return NextResponse.json({ error: 'Not a sub contractor' }, { status: 403 })
    }

    // Verify job is assigned to this sub
    const { data: job } = await supabase
      .from('production_jobs')
      .select('id, status')
      .eq('id', params.id)
      .eq('assigned_sub_id', subId)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found or not assigned to you' }, { status: 404 })
    }

    // Only allow specific status transitions
    const allowedTransitions: Record<string, string[]> = {
      scheduled: ['in_progress'],
      in_progress: ['complete'],
    }

    if (body.status) {
      const allowed = allowedTransitions[job.status] || []
      if (!allowed.includes(body.status)) {
        return NextResponse.json({ 
          error: `Cannot change status from ${job.status} to ${body.status}` 
        }, { status: 400 })
      }
    }

    // Build update object
    const updates: any = {}
    if (body.status) updates.status = body.status
    if (body.status === 'in_progress') updates.started_at = new Date().toISOString()
    if (body.status === 'complete') {
      updates.completed_at = new Date().toISOString()
      updates.completion_notes = body.completion_notes || null
    }

    const { error } = await supabase
      .from('production_jobs')
      .update(updates)
      .eq('id', params.id)
      .eq('assigned_sub_id', subId)

    if (error) {
      console.error('Error updating job:', error)
      return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in sub job update API:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
