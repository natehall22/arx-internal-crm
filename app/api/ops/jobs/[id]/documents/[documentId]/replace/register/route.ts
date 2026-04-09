import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildJobDocumentStoragePath, safeUploadFilename } from '@/lib/files/storage'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'

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
      .select('id, linked_record_type, is_protected')
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

    const body = await request.json().catch(() => null)
    const rawName = typeof body?.filename === 'string' ? body.filename : ''
    if (!rawName.trim()) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    const newDocumentId = crypto.randomUUID()
    const safeName = safeUploadFilename(rawName, 'document')
    const folder = resolveDocumentFolder(existingDocument.linked_record_type)
    const storagePath = buildJobDocumentStoragePath({
      orgId: profile.org_id,
      jobId,
      documentId: newDocumentId,
      filename: safeName,
      folder,
    })

    const signed = await signedUploadTokenForPath(supabase, FILES_BUCKET, storagePath)
    if ('error' in signed) {
      return NextResponse.json({ error: signed.error }, { status: 500 })
    }

    return NextResponse.json({
      newDocumentId,
      existingDocumentId,
      storagePath,
      bucket: FILES_BUCKET,
      signedUploadToken: signed.token,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to register document replacement'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
