import { NextResponse } from 'next/server'

import { LOGO_CACHE, signedOrgLogoUrl } from '@/lib/org-logo-serve'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/org-logo/<orgId>
 * Public (no login): the org logo is branding, not a secret — Nav shows it to staff and subs, proposal PDFs embed it, and
 * it must keep working once the `files` bucket is private. Signs ONLY `org/<orgId>/logo.<ext>` (orgLogoPath), never any
 * other object, and 302s to that signed URL. The redirect is cached briefly; the signed URL outlives the cache.
 * Readers build the link with `orgLogoHref` (lib/files/files-object.ts), whose `?v=` changes when a new logo is uploaded.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(_request: Request, { params }: { params: { orgId: string } }) {
  const orgId = String(params.orgId ?? '')
  if (!UUID_RE.test(orgId)) return notFound()

  try {
    const signedUrl = await signedOrgLogoUrl(createServiceClient(), orgId)
    if (!signedUrl) return notFound()
    return NextResponse.redirect(signedUrl, { status: 302, headers: { 'Cache-Control': LOGO_CACHE } })
  } catch (error) {
    console.error('[org-logo] error:', error)
    return NextResponse.json({ error: 'Could not load logo' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
