import { NextResponse } from 'next/server'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { customerDocumentFolder, loadCustomerDocuments } from '@/lib/customer-documents'
import { isAllowedCustomerDocumentName } from '@/lib/customer-document-categories'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'
import { FILES_BUCKET, buildCustomerDocumentStoragePath, safeUploadFilename } from '@/lib/files/storage'
import { loadProperty } from '@/lib/properties-db'
import { threadAuth } from '@/lib/threads/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** GET — the customer's own documents (no job). Same people as the Files tab (not pricing-barred roles). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read || !access.documents) return notFound()
  const documents = await loadCustomerDocuments(ctx.admin, ctx.viewer.orgId, params.id)
  return NextResponse.json({ documents, canUpload: access.editDocuments })
}

/**
 * POST — step 1 of an upload (register): body { filename, propertyId? } → a one-time signed upload URL. The browser uploads
 * straight to storage (no 4.5 MB request limit), then calls ./finalize. Nothing is listed until finalize writes the row.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read || !access.documents) return notFound()
  if (!access.editDocuments) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { filename?: unknown; propertyId?: unknown } | null
  const rawName = typeof body?.filename === 'string' ? body.filename : ''
  if (!rawName.trim()) return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  if (!isAllowedCustomerDocumentName(rawName)) return NextResponse.json({ error: 'Only PDF, photo (JPG, PNG, HEIC…), Word or CSV files can be added' }, { status: 400 })
  if (body?.propertyId != null) {
    const p = typeof body.propertyId === 'string' ? await loadProperty(ctx.admin, ctx.viewer.orgId, body.propertyId, false) : null
    if (!p || p.customer_id !== params.id) return NextResponse.json({ error: 'That property is not this customer’s' }, { status: 400 })
  }
  const documentId = crypto.randomUUID()
  const storagePath = buildCustomerDocumentStoragePath({
    orgId: ctx.viewer.orgId,
    customerId: params.id,
    documentId,
    filename: safeUploadFilename(rawName, 'document'),
  })
  // The path builder and the finalize lookup must agree on the folder.
  if (!storagePath.startsWith(`${customerDocumentFolder(ctx.viewer.orgId, params.id)}/`)) {
    return NextResponse.json({ error: 'Could not prepare the upload' }, { status: 500 })
  }
  const signed = await signedUploadTokenForPath(ctx.admin, FILES_BUCKET, storagePath)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ documentId, storagePath, bucket: FILES_BUCKET, signedUploadToken: signed.token })
}
