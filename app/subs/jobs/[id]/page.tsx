export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SubJobDetailClient from './SubJobDetailClient'

interface PageProps {
  params: { id: string }
}

export default async function SubJobDetailPage({ params }: PageProps) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  // Get sub_id for this user
  const { data: subId } = await supabase
    .rpc('get_sub_id_for_user', { user_uuid: profile.id })

  if (!subId) {
    redirect('/dashboard')
  }

  // Get sub info
  const { data: subInfo } = await supabase
    .from('sub_contractors')
    .select('company_name')
    .eq('id', subId)
    .single()

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
    notFound()
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

  return (
    <SubJobDetailClient 
      job={jobDetail} 
      companyName={subInfo?.company_name || 'Sub Portal'}
    />
  )
}
