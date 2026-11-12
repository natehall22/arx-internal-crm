import { NextRequest, NextResponse } from 'next/server'

import { isSigningKind } from '@/lib/signing/envelope'
import { markViewed } from '@/lib/signing/lifecycle'
import { findBySigningTokenOnThisHost } from '@/lib/signing-fence'
import { signingEvidence } from '@/lib/signing-input'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST { kind, token } — the signing page says "a person opened me". Public like the page: the link's token is the credential,
 * host-fenced (another company's address finds nothing). Records the first open only; answers 204 whatever happens (a beacon).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    if (!isSigningKind(body?.kind)) return new NextResponse(null, { status: 204 })
    const admin = createServiceClient()
    const row = await findBySigningTokenOnThisHost(admin, body.kind, body.token)
    if (row) {
      const { ip, userAgent } = signingEvidence(request.headers)
      await markViewed(admin, { kind: body.kind, row, ip, userAgent })
    }
  } catch (error) {
    console.error('[signing/viewed]', error)
  }
  return new NextResponse(null, { status: 204 })
}
