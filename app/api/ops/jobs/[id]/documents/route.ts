import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, buildJobDocumentStoragePath } from '@/lib/files/storage'
import { DocumentRole, LinkedRecordType, newDocumentInsert } from '@/lib/files/documents'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { resolveThreadViewer } from '@/lib/threads/viewer'

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

export async function GET(
  _request: Request,
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

    const baseCols = 'id, title, filename, category, document_role, version, status, is_protected, created_at, updated_at'
    const load = (cols: string) =>
      supabase.from('documents').select(cols).eq('job_id', jobId).eq('org_id', profile.org_id).is('deleted_at', null).order('updated_at', { ascending: false }).limit(50)
    // `shared_with_customer` only exists once the customer-portal migration is applied: fall back without it.
    let { data: documents, error } = await load(`${baseCols}, shared_with_customer`)
    if (error) ({ data: documents, error } = await load(baseCols))

    if (error) {
      return NextResponse.json({ error: error.message, code: (error as any).code || null }, { status: 500 })
    }

    // "Show to customer" is offered only when the company uses the portal, and only to people who may open the job's Files.
    const portalOn = await isOrgFeatureOn(profile.org_id, 'customerPortal')
    const viewer = portalOn ? await resolveThreadViewer(supabase, profile) : null
    const canShare = !!viewer && (viewer.ownerLike || viewer.jobBoard)

    return NextResponse.json({ documents: documents || [], portal: { on: portalOn, canShare } })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load documents' },
      { status: 500 }
    )
  }
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
