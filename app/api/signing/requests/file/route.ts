import { NextRequest, NextResponse } from 'next/server'

import { REQUEST_KIND, findSignerByToken } from '@/lib/signing/requests/db'
import { pdfResponse, readStoredPdf } from '@/lib/signing/requests/store'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET ?token=&which=source|signed|certificate — the PDF for a signer's own link (public, token + host fence). The document to
 * read while the request is open; the signed copy and certificate once it is complete. Nothing for a voided or declined one.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const admin = createServiceClient()
  const found = await findSignerByToken(admin, url.searchParams.get('token'))
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const which = url.searchParams.get('which') ?? 'source'
  const { request: r } = found
  let path: string | null = null
  if (which === 'source' && r.status === 'pending') path = r.source_path
  else if (which === 'signed' && r.status === 'completed') path = r.signed_path
  else if (which === 'certificate' && r.status === 'completed') {
    // org-scope-ok: org_id is the loaded signature request's company (found by the signer's hashed token), not a value from the HTTP request
    const { data: env } = await admin.from('signing_envelopes').select('certificate_path').eq('org_id', r.org_id).eq('doc_kind', REQUEST_KIND).eq('doc_id', r.id).maybeSingle()
    path = (env as { certificate_path?: string | null } | null)?.certificate_path ?? null
  }
  const bytes = path ? await readStoredPdf(admin, path) : null
  if (!bytes) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return pdfResponse(bytes, `${r.title}${which === 'certificate' ? ' - certificate' : ''}.pdf`, which === 'source')
}
