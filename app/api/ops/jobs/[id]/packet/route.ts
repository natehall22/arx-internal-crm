import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { generateJobPacketPDF } from '@/lib/pdf/job-packet'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createClient()
    
    let body: { force?: boolean } = {}
    try {
      body = await request.json()
    } catch {
      // No body provided, use defaults
    }

    const force = body.force === true

    // Check if packet already exists (idempotent)
    if (!force) {
      const { data: existingJob } = await supabase
        .from('production_jobs')
        .select('job_packet_pdf_path, job_packet_generated_at')
        .eq('id', params.id)
        .eq('org_id', profile.org_id)
        .single()

      if (existingJob?.job_packet_pdf_path) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        // Use files bucket (job-files bucket doesn't exist)
        return NextResponse.json({
          success: true,
          url: `${supabaseUrl}/storage/v1/object/public/files/${existingJob.job_packet_pdf_path}`,
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
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Fetch accepted proposal line items
    let lineItems: any[] = []
    if (job.accepted_proposal_id) {
      const { data: items } = await supabase
        .from('proposal_line_items')
        .select('name, description, category, quantity, unit')
        .eq('proposal_id', job.accepted_proposal_id)
        .order('sort_order')
      lineItems = items || []
    } else if (job.project_id) {
      // Fallback: find accepted proposal by project
      const { data: proposals } = await supabase
        .from('proposals')
        .select('id, scope_of_work')
        .eq('project_id', job.project_id)
        .not('accepted_at', 'is', null)
        .limit(1)

      if (proposals && proposals.length > 0) {
        const { data: items } = await supabase
          .from('proposal_line_items')
          .select('name, description, category, quantity, unit')
          .eq('proposal_id', proposals[0].id)
          .order('sort_order')
        lineItems = items || []
      }
    }

    // Fetch notes marked as share_with_sub
    const { data: sharedNotes } = await supabase
      .from('production_job_notes')
      .select('note, created_at')
      .eq('job_id', params.id)
      .eq('share_with_sub', true)
      .order('created_at', { ascending: false })
      .limit(5)

    // Transform data for PDF generation
    const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
    const crew = Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew
    const sub = Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub
    const project = Array.isArray(job.project) ? job.project[0] : job.project

    const packetData = {
      job_number: job.job_number,
      customer_name: customer?.name || 'N/A',
      customer_phone: customer?.phone || '',
      address: job.address_text,
      job_type: job.job_type,
      scheduled_date: job.scheduled_date,
      scheduled_time_start: job.scheduled_time_start,
      estimated_duration_hours: job.estimated_duration_hours,
      scope_of_work: project?.scope_of_work || '',
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
    console.log('[Job Packet] Generating PDF for job:', params.id)
    let pdfBuffer: Buffer
    try {
      pdfBuffer = await generateJobPacketPDF(packetData)
      console.log('[Job Packet] PDF generated, size:', pdfBuffer.length, 'bytes')
    } catch (pdfError: any) {
      console.error('[Job Packet] PDF generation failed:', pdfError?.message || pdfError)
      return NextResponse.json({ error: `PDF generation failed: ${pdfError?.message || 'Unknown error'}` }, { status: 500 })
    }

    // Upload to Supabase Storage using service client
    const serviceSupabase = createServiceClient()
    const storagePath = `${profile.org_id}/jobs/${params.id}/job-packet-${Date.now()}.pdf`

    // Upload to files bucket (the standard bucket that exists)
    const { error: uploadError } = await serviceSupabase.storage
      .from('files')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error('[Job Packet] Upload failed:', uploadError.message)
      return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 })
    }

    // Update job with PDF path
    const { error: updateError } = await serviceSupabase
      .from('production_jobs')
      .update({
        job_packet_pdf_path: storagePath,
        job_packet_generated_at: new Date().toISOString(),
      })
      .eq('id', params.id)

    if (updateError) {
      console.error('Update error:', updateError)
    }

    // Also insert into job_files table for tracking
    await serviceSupabase
      .from('job_files')
      .upsert({
        org_id: profile.org_id,
        job_id: params.id,
        file_type: 'other',
        storage_key: storagePath,
        file_name: `Job Packet - ${job.job_number}.pdf`,
        mime_type: 'application/pdf',
        is_signed: false,
        created_by: profile.id,
      }, {
        onConflict: 'job_id,file_type,version',
        ignoreDuplicates: true,
      })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    console.log('[Job Packet] Complete. Path:', storagePath)

    return NextResponse.json({
      success: true,
      url: `${supabaseUrl}/storage/v1/object/public/files/${storagePath}`,
      pdf_path: storagePath,
      generated_at: new Date().toISOString(),
      cached: false,
    })

  } catch (error: any) {
    console.error('[Job Packet] Unexpected error:', error?.message || error)
    return NextResponse.json({ error: error?.message || 'Failed to generate job packet' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createClient()

    // Check if packet PDF already exists
    const { data: job } = await supabase
      .from('production_jobs')
      .select('job_packet_pdf_path, job_packet_generated_at')
      .eq('id', params.id)
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
        ? `${supabaseUrl}/storage/v1/object/public/files/${job.job_packet_pdf_path}`
        : null,
      generated_at: job.job_packet_generated_at,
    })

  } catch (error) {
    console.error('Error checking job packet:', error)
    return NextResponse.json({ error: 'Failed to check job packet' }, { status: 500 })
  }
}
