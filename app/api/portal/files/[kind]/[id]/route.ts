import { NextResponse } from 'next/server'

import { signFilesObject } from '@/lib/files/files-object'
import { PORTAL_NO_STORE, portalJson, requirePortalApi } from '@/lib/portal/api'
import { findPortalFile } from '@/lib/portal/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — a document or photo the company shared with THIS customer: 302 to a 10-minute signed link. Anything else is a 404. */
export async function GET(request: Request, { params }: { params: { kind: string; id: string } }) {
  const c = await requirePortalApi(request)
  if (c instanceof Response) return c
  const kind = params.kind === 'photo' ? 'photo' : params.kind === 'document' ? 'document' : null
  const file = kind ? await findPortalFile(c.admin, c.session, kind, params.id) : null
  if (!file) return portalJson({ error: 'Not found' }, 404)
  // signFilesObject refuses an unsafe path (traversal, encoded dots) before anything is signed.
  const url = await signFilesObject(c.admin, file.storagePath, 60 * 10, { download: kind === 'document' })
  if (!url) return portalJson({ error: 'Not found' }, 404)
  return NextResponse.redirect(url, { status: 302, headers: PORTAL_NO_STORE })
}
