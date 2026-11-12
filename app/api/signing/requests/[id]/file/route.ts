import { NextRequest, NextResponse } from 'next/server'

import { canViewDocuments } from '@/lib/signing/access'
import { REQUEST_KIND, loadRequest } from '@/lib/signing/requests/db'
import { redirectToStored } from '@/lib/signing/requests/store'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'

export const dynamic = 'force-dynamic'

/** GET /api/signing/requests/<id>/file?which=source|signed|certificate — the PDF itself for the office. Same company only. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(null)
  if ('error' in g) return g.error
  const orgId = g.profile.org_id as string
  const loaded = await loadRequest(g.admin, orgId, params.id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
  if (!(await canViewDocuments(g.admin, g.profile)) && loaded.request.created_by !== g.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE })
  const which = new URL(request.url).searchParams.get('which') ?? 'signed'
  let path: string | null = null
  if (which === 'source') path = loaded.request.source_path
  else if (which === 'signed') path = loaded.request.signed_path
  else if (which === 'certificate') {
    const { data: env } = await g.admin.from('signing_envelopes').select('certificate_path').eq('org_id', orgId).eq('doc_kind', REQUEST_KIND).eq('doc_id', params.id).maybeSingle()
    path = (env as { certificate_path?: string | null } | null)?.certificate_path ?? null
  }
  return redirectToStored(g.admin, path, false)
}
