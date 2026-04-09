import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET } from '@/lib/files/storage'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'
import { createReplacementDocumentVersion, type DocumentRowForVersioning } from '@/lib/files/documents'

export const runtime = 'nodejs'

function resolveDocumentFolder(linkedRecordType: string | null) {
  if (linkedRecordType === 'contract') return 'contracts'
  if (linkedRecordType === 'change_order') return 'change_orders'
  return 'documents'
}

export async function POST(
  request: Request,
  { params }: { params: { id: string; documentId: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const jobId = params.id
    const existingDocumentId = params.documentId

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const newDocumentId =
      typeof body?.new_document_id === 'string'
        ? body.new_document_id
        : typeof body?.newDocumentId === 'string'
          ? body.newDocumentId
          : ''
    if (!newDocumentId) {
      return NextResponse.json({ error: 'newDocumentId is required' }, { status: 400 })
    }

    const versionNote = body?.version_note != null ? String(body.version_note) : null
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

    const { data: existingDocument } = await supabase
      .from('documents')
      .select(
        'id, org_id, job_id, customer_id, linked_record_type, linked_record_id, document_role, category, title, description, is_protected, version'
      )
      .eq('id', existingDocumentId)
      .eq('org_id', profile.org_id)
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .single()

    if (!existingDocument) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (
      existingDocument.is_protected &&
      !['admin', 'owner', 'operations', 'regional_manager'].includes(profile.role)
    ) {
      return NextResponse.json(
        { error: 'Protected document replacement is restricted' },
        { status: 403 }
      )
    }

    const folder = resolveDocumentFolder(existingDocument.linked_record_type)
    const folderPath = `${profile.org_id}/jobs/${jobId}/${folder}`
    const found = await findStorageObjectByRecordPrefix(supabase, FILES_BUCKET, folderPath, newDocumentId)
    if (!found) {
      return NextResponse.json(
        { error: 'Upload not found in storage. Try uploading again.' },
        { status: 400 }
      )
    }

    const versionPayloads = createReplacementDocumentVersion({
      previous: existingDocument as DocumentRowForVersioning,
      storagePath: found.storagePath,
      filename: found.displayFilename,
      fileSize: found.size ?? fileSize,
      mimeType: mimeType || found.mimeType,
      uploadedBy: profile.id,
      versionNote,
    })

    const { error: supersedeError } = await supabase
      .from('documents')
      .update(versionPayloads.previousDocumentUpdate)
      .eq('id', existingDocumentId)
      .eq('org_id', profile.org_id)

    if (supersedeError) {
      return NextResponse.json({ error: supersedeError.message }, { status: 500 })
    }

    const { data: newDocument, error: newDocumentError } = await supabase
      .from('documents')
      .insert({
        id: newDocumentId,
        ...versionPayloads.newDocumentInsert,
      })
      .select('*')
      .single()

    if (newDocumentError) {
      await supabase
        .from('documents')
        .update({ status: 'active' })
        .eq('id', existingDocumentId)
        .eq('org_id', profile.org_id)

      await supabase.storage.from(FILES_BUCKET).remove([found.storagePath])

      return NextResponse.json({ error: newDocumentError.message }, { status: 500 })
    }

    return NextResponse.json({ document: newDocument })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to finalize document replacement'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
