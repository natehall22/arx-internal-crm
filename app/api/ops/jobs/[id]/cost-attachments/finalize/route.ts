import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET } from '@/lib/files/storage'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'
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

    const body = await request.json().catch(() => null)
    const attachmentId =
      typeof body?.attachment_id === 'string'
        ? body.attachment_id
        : typeof body?.attachmentId === 'string'
          ? body.attachmentId
          : ''
    const documentId =
      typeof body?.document_id === 'string'
        ? body.document_id
        : typeof body?.documentId === 'string'
          ? body.documentId
          : ''
    const jobCostLineId =
      typeof body?.job_cost_line_id === 'string'
        ? body.job_cost_line_id
        : typeof body?.jobCostLineId === 'string'
          ? body.jobCostLineId
          : ''

    if (!attachmentId || !documentId || !jobCostLineId) {
      return NextResponse.json(
        { error: 'attachmentId, documentId, and job_cost_line_id are required' },
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

    const mimeType =
      typeof body?.mime_type === 'string'
        ? body.mime_type
        : typeof body?.mimeType === 'string'
          ? body.mimeType
          : null
    const fileSize =
      typeof body?.file_size === 'number'
        ? body.file_size
        : typeof body?.fileSize === 'number'
          ? body.fileSize
          : null

    const folderPath = `${profile.org_id}/jobs/${jobId}/costs`
    const found = await findStorageObjectByRecordPrefix(supabase, FILES_BUCKET, folderPath, attachmentId)
    if (!found) {
      return NextResponse.json(
        { error: 'Upload not found in storage. Try uploading again.' },
        { status: 400 }
      )
    }

    const documentPayload = newDocumentInsert({
      orgId: profile.org_id,
      jobId,
      customerId: job.customer_id || null,
      linkedRecordType: null,
      linkedRecordId: null,
      documentRole: null,
      storagePath: found.storagePath,
      filename: found.displayFilename,
      fileSize: found.size ?? fileSize,
      mimeType: mimeType || found.mimeType,
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
      await supabase.storage.from(FILES_BUCKET).remove([found.storagePath])
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
      await supabase.storage.from(FILES_BUCKET).remove([found.storagePath])
      await supabase
        .from('documents')
        .update({ status: 'archived' })
        .eq('id', document.id)
        .eq('org_id', profile.org_id)
      return NextResponse.json({ error: attachmentError.message }, { status: 500 })
    }

    return NextResponse.json({ attachment, document })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to finalize cost attachment upload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
