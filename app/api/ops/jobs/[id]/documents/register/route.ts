import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildJobDocumentStoragePath, safeUploadFilename } from '@/lib/files/storage'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'
import type { DocumentRole, LinkedRecordType } from '@/lib/files/documents'

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
      .select('id')
      .eq('id', jobId)
      .eq('org_id', profile.org_id)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const rawName = typeof body?.filename === 'string' ? body.filename : ''
    if (!rawName.trim()) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    const documentRole = (body?.document_role ?? body?.documentRole ?? null) as DocumentRole
    const linkedRecordType = (body?.linked_record_type ?? body?.linkedRecordType ?? null) as LinkedRecordType
    const linkedRecordId = body?.linked_record_id ?? body?.linkedRecordId ?? null

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

    const documentId = crypto.randomUUID()
    const safeName = safeUploadFilename(rawName, 'document')
    const folder = resolveDocumentFolder(linkedRecordType)
    const storagePath = buildJobDocumentStoragePath({
      orgId: profile.org_id,
      jobId,
      documentId,
      filename: safeName,
      folder,
    })

    const signed = await signedUploadTokenForPath(supabase, FILES_BUCKET, storagePath)
    if ('error' in signed) {
      return NextResponse.json({ error: signed.error }, { status: 500 })
    }

    return NextResponse.json({
      documentId,
      storagePath,
      bucket: FILES_BUCKET,
      folder,
      signedUploadToken: signed.token,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to register document upload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
