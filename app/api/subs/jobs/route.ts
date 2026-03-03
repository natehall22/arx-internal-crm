import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const { profile } = await requireAuth()
    const supabase = createClient()

    // Get sub_id for this user
    const { data: subData } = await supabase
      .rpc('get_sub_id_for_user', { user_uuid: profile.id })

    if (!subData) {
      return NextResponse.json({ error: 'Not a sub contractor' }, { status: 403 })
    }

    // Fetch jobs assigned to this sub
    const { data: jobs, error } = await supabase
      .from('production_jobs')
      .select(`
        id,
        job_number,
        job_type,
        status,
        address_text,
        scheduled_date,
        scheduled_time_start,
        estimated_duration_hours,
        customer:customers(name, phone),
        project:projects(scope_of_work, product_summary)
      `)
      .eq('assigned_sub_id', subData)
      .in('status', ['scheduled', 'in_progress', 'complete'])
      .order('scheduled_date', { ascending: true })

    if (error) {
      console.error('Error fetching sub jobs:', error)
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
    }

    // Transform the data
    const transformedJobs = (jobs || []).map((job: any) => ({
      id: job.id,
      job_number: job.job_number,
      job_type: job.job_type,
      status: job.status,
      address_text: job.address_text,
      scheduled_date: job.scheduled_date,
      scheduled_time_start: job.scheduled_time_start,
      estimated_duration_hours: job.estimated_duration_hours,
      customer_name: Array.isArray(job.customer) ? job.customer[0]?.name : job.customer?.name,
      customer_phone: Array.isArray(job.customer) ? job.customer[0]?.phone : job.customer?.phone,
      scope_of_work: Array.isArray(job.project) ? job.project[0]?.scope_of_work : job.project?.scope_of_work,
      product_summary: Array.isArray(job.project) ? job.project[0]?.product_summary : job.project?.product_summary,
    }))

    return NextResponse.json({ jobs: transformedJobs })

  } catch (error) {
    console.error('Error in sub jobs API:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
