import { NextRequest, NextResponse } from 'next/server'

import { canSendDocuments } from '@/lib/signing/access'
import { pdfResponse, readStoredPdf } from '@/lib/signing/requests/store'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'

export const dynamic = 'force-dynamic'

/** GET /api/signing/templates/<id>/file — the template's PDF, to draw its pages in the editor. Same company only. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const g = await staffSigningGate(null)
  if ('error' in g) return g.error
  if (!(await canSendDocuments(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE })
  const { data: t } = await g.admin.from('signature_templates').select('name, source_path').eq('org_id', g.profile.org_id).eq('id', params.id).is('archived_at', null).maybeSingle()
  const bytes = t ? await readStoredPdf(g.admin, (t as { source_path: string }).source_path) : null
  if (!bytes) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
  return pdfResponse(bytes, `${(t as { name: string }).name}.pdf`)
}
