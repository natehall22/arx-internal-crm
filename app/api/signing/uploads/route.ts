import { NextRequest, NextResponse } from 'next/server'

import { canSendDocuments } from '@/lib/signing/access'
import { createUploadSlot } from '@/lib/signing/requests/store'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { PRIVATE, staffSigningGate } from '@/lib/signing/staff-gate'

export const dynamic = 'force-dynamic'

/**
 * POST /api/signing/uploads — a one-time signed upload URL so the browser sends the PDF straight to storage (no PDF in a function
 * body). The slot is inside the company's own folder; the create routes re-check what arrived (type, size, pages, hash).
 */
export async function POST(request: NextRequest) {
  const g = await staffSigningGate(request)
  if ('error' in g) return g.error
  if (!(await canSendDocuments(g.admin, { id: g.userId, role: g.profile.role, custom_role_id: g.profile.custom_role_id }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE })
  const orgId = g.profile.org_id as string
  if (!(await loadSigningSettings(g.admin, orgId)).customDocuments) return NextResponse.json({ error: 'Sending your own documents is turned off for your company.' }, { status: 403, headers: PRIVATE })
  const slot = await createUploadSlot(g.admin, orgId)
  if (!slot.ok) return NextResponse.json({ error: slot.error }, { status: 500, headers: PRIVATE })
  return NextResponse.json({ path: slot.path, signedUrl: slot.signedUrl }, { status: 201, headers: PRIVATE })
}
