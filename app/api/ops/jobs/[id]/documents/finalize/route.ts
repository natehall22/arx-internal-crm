import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET } from '@/lib/files/storage'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'
import { newDocumentInsert, type DocumentRole, type LinkedRecordType } from '@/lib/files/documents'

export const runtime = 'nodejs'

const ALLOWED_DOCUMENT_ROLES = new Set([
  'draft',
  'signed_executed',
  'supporting_attachment',
  'customer_copy',
  'internal_copy',
])

function resolveDocumentFolder(linkedRecordType: LinkedRecordType) {
  if (linkedRecordType === 'contract') return 'contracts'
  if (linkedRecordType === 'change_order') return 'change_orders'
  return 'documents'
}

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
    const documentId =
      typeof body?.document_id === 'string'
        ? body.document_id
        : typeof body?.documentId === 'string'
          ? body.documentId
          : ''
    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }

    const category = typeof body?.category === 'string' ? body.category : 'misc'
    const title = body?.title != null ? String(body.title) : null
    const description = body?.description != null ? String(body.description) : null
    const documentRole = (body?.document_role ?? body?.documentRole ?? null) as DocumentRole
    const linkedRecordType = (body?.linked_record_type ?? body?.linkedRecordType ?? null) as LinkedRecordType
    const linkedRecordId = body?.linked_record_id ?? body?.linkedRecordId ?? null

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

    if (documentRole !== null && !ALLOWED_DOCUMENT_ROLES.has(documentRole as string)) {
      return NextResponse.json({ error: 'Invalid document_role' }, { status: 400 })
    }

    if (
      linkedRecordType !== null &&
      linkedRecordType !== 'contract' &&
      linkedRecordType !== 'change_order'
    ) {
      return NextResponse.json({ error: 'Invalid linked_record_type' }, { status: 400 })
    }

    if (linkedRecordType && !linkedRecordId) {
      return NextResponse.json(
        { error: 'linked_record_id is required when linked_record_type is set' },
        { status: 400 }
      )
    }

    const folder = resolveDocumentFolder(linkedRecordType)
    const folderPath = `${profile.org_id}/jobs/${jobId}/${folder}`
    const found = await findStorageObjectByRecordPrefix(supabase, FILES_BUCKET, folderPath, documentId)
    if (!found) {
      return NextResponse.json(
        { error: 'Upload not found in storage. Try uploading again.' },
        { status: 400 }
      )
    }

    const insertPayload = newDocumentInsert({
      orgId: profile.org_id,
      jobId,
      customerId: job.customer_id || null,
      linkedRecordType,
      linkedRecordId: linkedRecordId ? String(linkedRecordId) : null,
      documentRole,
      storagePath: found.storagePath,
      filename: found.displayFilename,
      fileSize: found.size ?? fileSize,
      mimeType: mimeType || found.mimeType,
      category,
      title,
      description,
      uploadedBy: profile.id,
    })

    const { data: document, error: insertError } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        ...insertPayload,
      })
      .select('*')
      .single()

    if (insertError) {
      await supabase.storage.from(FILES_BUCKET).remove([found.storagePath])
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ document })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to finalize document upload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
