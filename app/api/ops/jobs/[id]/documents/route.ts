import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildJobDocumentStoragePath } from '@/lib/files/storage'
import { DocumentRole, LinkedRecordType, newDocumentInsert } from '@/lib/files/documents'

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

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const category = String(formData.get('category') || 'misc')
    const titleRaw = formData.get('title')
    const descriptionRaw = formData.get('description')
    const documentRoleRaw = formData.get('document_role')
    const linkedRecordTypeRaw = formData.get('linked_record_type')
    const linkedRecordIdRaw = formData.get('linked_record_id')

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    const documentRole =
      (documentRoleRaw ? String(documentRoleRaw) : null) as DocumentRole
    const linkedRecordType =
      (linkedRecordTypeRaw ? String(linkedRecordTypeRaw) : null) as LinkedRecordType
    const linkedRecordId = linkedRecordIdRaw ? String(linkedRecordIdRaw) : null

    if (documentRole !== null && !ALLOWED_DOCUMENT_ROLES.has(documentRole)) {
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

    const documentId = crypto.randomUUID()
    const storagePath = buildJobDocumentStoragePath({
      orgId: profile.org_id,
      jobId,
      documentId,
      filename: file.name,
      folder: resolveDocumentFolder(linkedRecordType),
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

    const insertPayload = newDocumentInsert({
      orgId: profile.org_id,
      jobId,
      customerId: job.customer_id || null,
      linkedRecordType,
      linkedRecordId,
      documentRole,
      storagePath,
      filename: file.name,
      fileSize: file.size,
      mimeType: file.type || null,
      category,
      title: titleRaw ? String(titleRaw) : null,
      description: descriptionRaw ? String(descriptionRaw) : null,
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
      await supabase.storage.from(FILES_BUCKET).remove([storagePath])
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ document })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to upload document' },
      { status: 500 }
    )
  }
}
