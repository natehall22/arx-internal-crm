import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import { generateJobPacketPDF } from '@/lib/pdf/job-packet'

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { profile } = await requireAuth()
    const supabase = createClient()
    
    let body: { force?: boolean } = {}
    try {
      body = await request.json()
    } catch {
      // No body provided, use defaults
    }

    const force = body.force === true

    // Check if packet already exists (idempotent behavior)
    if (!force) {
      const { data: existingJob } = await supabase
        .from('production_jobs')
        .select('job_packet_pdf_path, job_packet_generated_at')
        .eq('id', params.jobId)
        .eq('org_id', profile.org_id)
        .single()

      if (existingJob?.job_packet_pdf_path) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        return NextResponse.json({
          success: true,
          url: `${supabaseUrl}/storage/v1/object/public/job-files/${existingJob.job_packet_pdf_path}`,
          pdf_path: existingJob.job_packet_pdf_path,
          generated_at: existingJob.job_packet_generated_at,
          cached: true,
        })
      }
    }

    // Fetch job with all related data for the packet
    const { data: job, error: jobError } = await supabase
      .from('production_jobs')
      .select(`
        *,
        customer:customers(name, phone, email),
        assigned_crew:crews(name, phone),
        assigned_sub:sub_contractors(company_name, contact_name, phone),
        project:projects(scope_of_work, product_summary)
      `)
      .eq('id', params.jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Fetch accepted proposal line items
    let lineItems: any[] = []
    let scopeOfWork = ''

    // Strategy 1: Use accepted_proposal_id on job
    if (job.accepted_proposal_id) {
      const { data: proposal } = await supabase
        .from('proposals')
        .select('scope_of_work')
        .eq('id', job.accepted_proposal_id)
        .single()
      
      if (proposal?.scope_of_work) {
        scopeOfWork = proposal.scope_of_work
      }

      const { data: items } = await supabase
        .from('proposal_line_items')
        .select('name, description, category, quantity, unit')
        .eq('proposal_id', job.accepted_proposal_id)
        .order('sort_order')
      lineItems = items || []
    } 
    // Strategy 2: Find accepted proposal by project_id
    else if (job.project_id) {
      const { data: proposals } = await supabase
        .from('proposals')
        .select('id, scope_of_work')
        .eq('project_id', job.project_id)
        .not('accepted_at', 'is', null)
        .limit(1)

      if (proposals && proposals.length > 0) {
        scopeOfWork = proposals[0].scope_of_work || ''
        
        const { data: items } = await supabase
          .from('proposal_line_items')
          .select('name, description, category, quantity, unit')
          .eq('proposal_id', proposals[0].id)
          .order('sort_order')
        lineItems = items || []
      }
    }

    // Fallback scope from project
    const project = Array.isArray(job.project) ? job.project[0] : job.project
    if (!scopeOfWork && project?.scope_of_work) {
      scopeOfWork = project.scope_of_work
    }

    // Fetch notes marked as share_with_sub
    const { data: sharedNotes } = await supabase
      .from('production_job_notes')
      .select('note, created_at')
      .eq('job_id', params.jobId)
      .eq('share_with_sub', true)
      .order('created_at', { ascending: false })
      .limit(5)

    // Transform data for PDF generation
    const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
    const crew = Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew
    const sub = Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub

    const packetData = {
      job_number: job.job_number,
      customer_name: customer?.name || 'N/A',
      customer_phone: customer?.phone || '',
      address: job.address_text,
      job_type: job.job_type,
      scheduled_date: job.scheduled_date,
      scheduled_time_start: job.scheduled_time_start,
      estimated_duration_hours: job.estimated_duration_hours,
      scope_of_work: scopeOfWork,
      product_summary: project?.product_summary || '',
      special_instructions: job.special_instructions || '',
      line_items: lineItems,
      shared_notes: sharedNotes || [],
      assigned_to: crew?.name || sub?.company_name || 'Unassigned',
      permit_required: job.permit_required,
      permit_number: job.permit_number,
      photo_checklist: [
        'Front of house',
        'Back of house',
        'Left side',
        'Right side',
        'Slope detail 1',
        'Slope detail 2',
        'Flashing details',
        'Pipe boots',
        'Cleanup complete',
      ],
    }

    // Generate PDF
    const pdfBuffer = await generateJobPacketPDF(packetData)

    // Upload to Supabase Storage using service client
    const serviceSupabase = createServiceClient()
    const storagePath = `${profile.org_id}/jobs/${params.jobId}/job-packet-${Date.now()}.pdf`

    const { error: uploadError } = await serviceSupabase.storage
      .from('job-files')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload PDF' }, { status: 500 })
    }

    // Update job with PDF path
    await serviceSupabase
      .from('production_jobs')
      .update({
        job_packet_pdf_path: storagePath,
        job_packet_generated_at: new Date().toISOString(),
      })
      .eq('id', params.jobId)

    // Insert into job_files table for tracking
    await serviceSupabase
      .from('job_files')
      .insert({
        org_id: profile.org_id,
        job_id: params.jobId,
        file_type: 'other',
        storage_key: storagePath,
        file_name: `Job Packet - ${job.job_number}.pdf`,
        mime_type: 'application/pdf',
        is_signed: false,
        notes: 'Auto-generated job packet',
        created_by: profile.id,
      })
      .select()
      .single()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

    return NextResponse.json({
      success: true,
      url: `${supabaseUrl}/storage/v1/object/public/job-files/${storagePath}`,
      pdf_path: storagePath,
      generated_at: new Date().toISOString(),
      cached: false,
    })

  } catch (error) {
    console.error('Error generating job packet:', error)
    return NextResponse.json({ error: 'Failed to generate job packet' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { profile } = await requireAuth()
    const supabase = createClient()

    // Check if packet PDF already exists
    const { data: job } = await supabase
      .from('production_jobs')
      .select('job_packet_pdf_path, job_packet_generated_at')
      .eq('id', params.jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

    return NextResponse.json({
      has_packet: !!job.job_packet_pdf_path,
      pdf_path: job.job_packet_pdf_path,
      url: job.job_packet_pdf_path 
        ? `${supabaseUrl}/storage/v1/object/public/job-files/${job.job_packet_pdf_path}`
        : null,
      generated_at: job.job_packet_generated_at,
    })

  } catch (error) {
    console.error('Error checking job packet:', error)
    return NextResponse.json({ error: 'Failed to check job packet' }, { status: 500 })
  }
}
