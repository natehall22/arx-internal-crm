import { NextResponse } from 'next/server'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { customerDocumentFolder, isCustomerDocumentCategory } from '@/lib/customer-documents'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'
import { newDocumentInsert } from '@/lib/files/documents'
import { FILES_BUCKET } from '@/lib/files/storage'
import { loadProperty } from '@/lib/properties-db'
import { orgDb } from '@/lib/supabase/org-db'
import { threadAuth } from '@/lib/threads/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST — step 2 of an upload: body { documentId, category, title?, propertyId?, mime_type?, file_size? }. Finds the object
 * the browser uploaded under this customer's folder and writes the `documents` row (job_id NULL). If the row cannot be
 * written the object is removed, so storage never holds a file nobody can see.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read || !access.documents) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.editDocuments) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const documentId = typeof body?.documentId === 'string' ? body.documentId : ''
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
  const rawCategory = body?.category
  const category = isCustomerDocumentCategory(rawCategory) ? rawCategory : 'misc'
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : null
  let propertyId: string | null = null
  if (body?.propertyId != null) {
    const p = typeof body.propertyId === 'string' ? await loadProperty(ctx.admin, ctx.viewer.orgId, body.propertyId, false) : null
    if (!p || p.customer_id !== params.id) return NextResponse.json({ error: 'That property is not this customer’s' }, { status: 400 })
    propertyId = p.id
  }

  const found = await findStorageObjectByRecordPrefix(ctx.admin, FILES_BUCKET, customerDocumentFolder(ctx.viewer.orgId, params.id), documentId)
  if (!found) return NextResponse.json({ error: 'Upload not found in storage. Try uploading again.' }, { status: 400 })

  const insert = newDocumentInsert({
    orgId: ctx.viewer.orgId,
    jobId: null,
    customerId: params.id,
    storagePath: found.storagePath,
    filename: found.displayFilename,
    fileSize: found.size ?? (typeof body?.file_size === 'number' ? body.file_size : null),
    mimeType: found.mimeType ?? (typeof body?.mime_type === 'string' ? body.mime_type : null),
    category,
    title,
    uploadedBy: ctx.profile.id,
  })
  const { data, error } = await orgDb(ctx.admin, ctx.viewer.orgId)
    .from('documents')
    .insert({ id: documentId, ...insert, ...(propertyId ? { property_id: propertyId } : {}) })
    .select('id')
    .single()
  if (error || !data) {
    await ctx.admin.storage.from(FILES_BUCKET).remove([found.storagePath])
    console.error('[customer-documents] finalize failed', error)
    return NextResponse.json({ error: error?.code === '23505' ? 'That upload was already saved' : 'Could not save the document' }, { status: error?.code === '23505' ? 409 : 500 })
  }
  return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 })
}
