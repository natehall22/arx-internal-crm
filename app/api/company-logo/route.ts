import { NextResponse } from 'next/server'

import { getRequestHostFence } from '@/lib/company-host-server'
import { LOGO_CACHE, signedOrgLogoUrl } from '@/lib/org-logo-serve'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * GET /api/company-logo — the logo of the company this address belongs to, for signed-out pages (login, reset,
 * metadata icons). Resolved from the host (DEPLOYMENT_ORG_ID > company address) and served as bytes, never as a
 * redirect: a signed-out visitor never sees the company's internal id (it is in the storage path).
 */
export async function GET() {
  const fence = await getRequestHostFence()
  if (fence.kind !== 'org') return notFound()
  try {
    const signedUrl = await signedOrgLogoUrl(createServiceClient(), fence.orgId)
    if (!signedUrl) return notFound()
    const upstream = await fetch(signedUrl, { cache: 'no-store' })
    const type = upstream.headers.get('content-type') ?? ''
    if (!upstream.ok || !type.startsWith('image/')) return notFound()
    const bytes = await upstream.arrayBuffer()
    if (bytes.byteLength > MAX_LOGO_BYTES) return notFound()
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': LOGO_CACHE,
        'X-Content-Type-Options': 'nosniff',
        // Served from the app's own origin: an uploaded SVG must never run script here.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    })
  } catch (error) {
    console.error('[company-logo] error:', error)
    return NextResponse.json({ error: 'Could not load logo' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
