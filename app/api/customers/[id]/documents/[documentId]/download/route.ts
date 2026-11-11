import { NextResponse } from 'next/server'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import { findCustomerDocument } from '@/lib/customer-documents'
import { FILES_BUCKET } from '@/lib/files/storage'
import { threadAuth } from '@/lib/threads/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0' }

/** GET — 302 to a 10-minute signed link for one customer-level document, served as a download (Content-Disposition:
 * attachment), never rendered inline from storage. Anything not allowed or not there is a 404. */
export async function GET(_request: Request, { params }: { params: { id: string; documentId: string } }) {
  const ctx = await threadAuth()
  if (ctx instanceof NextResponse) return ctx
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
  const access = await resolveCustomerAccess(ctx.admin, ctx.viewer, params.id)
  if (!access?.read || !access.documents) return notFound()
  const doc = await findCustomerDocument(ctx.admin, ctx.viewer.orgId, params.id, params.documentId)
  if (!doc) return notFound()
  const { data, error } = await ctx.admin.storage.from(FILES_BUCKET).createSignedUrl(doc.storage_path, 60 * 10, { download: true })
  if (error || !data?.signedUrl) return notFound()
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: PRIVATE })
}
