import { NextResponse } from 'next/server'

import { filesPathFromStoredUrl, signFilesObject } from '@/lib/files/files-object'
import { loadApproval } from '@/lib/quotes/approve'
import { resolvePublicQuoteLink } from '@/lib/quotes/links'
import { approvalPdfPath } from '@/lib/quotes/approval-pdf-path'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET — the customer's approved copy (PDF) of a PLAN-ONLY quote, which has no contract to download it through. The quote link
 * token is the credential (as on the quote page); the file is handed over as a short-lived signed address.
 */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const link = await resolvePublicQuoteLink(admin, params.token)
  if (!link) return NextResponse.json({ error: 'This link is not active' }, { status: 404 })
  const approval = await loadApproval(admin, link.org_id, link.proposal_id)
  const stored = approval ? await approvalPdfPath(admin, link.org_id, approval) : null
  const path = filesPathFromStoredUrl(stored)
  const url = path ? await signFilesObject(admin, path, 300) : null
  if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.redirect(url, 302)
}
