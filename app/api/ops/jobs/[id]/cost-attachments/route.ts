import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildCostAttachmentStoragePath } from '@/lib/files/storage'
import { newDocumentInsert } from '@/lib/files/documents'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const jobId = params.id

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id, customer_id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const jobCostLineId = String(formData.get('job_cost_line_id') || '')

    if (!file || !jobCostLineId) {
      return NextResponse.json(
        { error: 'job_cost_line_id and file are required' },
        { status: 400 }
      )
    }

    const { data: costLine } = await supabase
      .from('job_cost_lines')
      .select('id, job_id')
      .eq('id', jobCostLineId)
      .eq('org_id', profile.org_id)
      .eq('job_id', jobId)
      .single()

    if (!costLine) {
      return NextResponse.json({ error: 'Cost line not found' }, { status: 404 })
    }

    const attachmentId = crypto.randomUUID()
    const documentId = crypto.randomUUID()

    const storagePath = buildCostAttachmentStoragePath({
      orgId: profile.org_id,
      jobId,
      attachmentId,
      filename: file.name,
    })

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from(FILES_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const documentPayload = newDocumentInsert({
      orgId: profile.org_id,
      jobId,
      customerId: job.customer_id || null,
      linkedRecordType: null,
      linkedRecordId: null,
      documentRole: null,
      storagePath,
      filename: file.name,
      fileSize: file.size,
      mimeType: file.type || null,
      category: 'cost_attachment',
      title: null,
      description: null,
      uploadedBy: profile.id,
    })

    const { data: document, error: documentError } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        ...documentPayload,
      })
      .select('*')
      .single()

    if (documentError) {
      await supabase.storage.from(FILES_BUCKET).remove([storagePath])
      return NextResponse.json({ error: documentError.message }, { status: 500 })
    }

    const { data: attachment, error: attachmentError } = await supabase
      .from('cost_attachments')
      .insert({
        id: attachmentId,
        org_id: profile.org_id,
        job_cost_line_id: jobCostLineId,
        document_id: document.id,
        created_by: profile.id,
      })
      .select('*')
      .single()

    if (attachmentError) {
      await supabase.storage.from(FILES_BUCKET).remove([storagePath])
      await supabase
        .from('documents')
        .update({ status: 'archived' })
        .eq('id', document.id)
        .eq('org_id', profile.org_id)
      return NextResponse.json({ error: attachmentError.message }, { status: 500 })
    }

    return NextResponse.json({ attachment, document })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to upload cost attachment' },
      { status: 500 }
    )
  }
}
