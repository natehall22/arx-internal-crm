import { NextResponse } from 'next/server'

import { orgLogoPath, signFilesObject } from '@/lib/files/files-object'
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
const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60
const LOGO_CACHE = 'public, max-age=300, s-maxage=300'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(_request: Request, { params }: { params: { orgId: string } }) {
  const orgId = String(params.orgId ?? '')
  if (!UUID_RE.test(orgId)) return notFound()

  try {
    const admin = createServiceClient()
    const { data: org } = await admin.from('orgs').select('logo_url, settings').eq('id', orgId).maybeSingle()
    const path = orgLogoPath(orgId, org)
    if (!path) return notFound()

    const signedUrl = await signFilesObject(admin, path, LOGO_SIGNED_URL_TTL_SECONDS)
    if (!signedUrl) return notFound()
    return NextResponse.redirect(signedUrl, { status: 302, headers: { 'Cache-Control': LOGO_CACHE } })
  } catch (error) {
    console.error('[org-logo] error:', error)
    return NextResponse.json({ error: 'Could not load logo' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
