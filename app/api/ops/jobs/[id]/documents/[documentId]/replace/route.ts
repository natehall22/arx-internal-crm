import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildJobDocumentStoragePath } from '@/lib/files/storage'
import { createReplacementDocumentVersion, DocumentRowForVersioning } from '@/lib/files/documents'

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

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const versionNoteRaw = formData.get('version_note')

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    const newDocumentId = crypto.randomUUID()
    const storagePath = buildJobDocumentStoragePath({
      orgId: profile.org_id,
      jobId,
      documentId: newDocumentId,
      filename: file.name,
      folder: resolveDocumentFolder(existingDocument.linked_record_type),
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

    const versionPayloads = createReplacementDocumentVersion({
      previous: existingDocument as DocumentRowForVersioning,
      storagePath,
      filename: file.name,
      fileSize: file.size,
      mimeType: file.type || null,
      uploadedBy: profile.id,
      versionNote: versionNoteRaw ? String(versionNoteRaw) : null,
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
      // best-effort rollback to previous status
      await supabase
        .from('documents')
        .update({ status: 'active' })
        .eq('id', existingDocumentId)
        .eq('org_id', profile.org_id)

      await supabase.storage.from(FILES_BUCKET).remove([storagePath])

      return NextResponse.json({ error: newDocumentError.message }, { status: 500 })
    }

    return NextResponse.json({ document: newDocument })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to replace document version' },
      { status: 500 }
    )
  }
}
