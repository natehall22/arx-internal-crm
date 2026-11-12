import { NextRequest, NextResponse } from 'next/server'

import { isSigningKind } from '@/lib/signing/envelope'
import { declineEnvelope } from '@/lib/signing/lifecycle'
import { findBySigningTokenOnThisHost } from '@/lib/signing-fence'
import { signingEvidence } from '@/lib/signing-input'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** POST { kind, token, reason } — the signer says they will not sign and why. Public (the link's token), host-fenced. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    if (!isSigningKind(body?.kind)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const admin = createServiceClient()
    const row = await findBySigningTokenOnThisHost(admin, body.kind, body.token)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { ip, userAgent } = signingEvidence(request.headers)
    const result = await declineEnvelope(admin, { kind: body.kind, row, reason: body.reason, ip, userAgent })
    if (result.ok) return NextResponse.json({ success: true })
    return NextResponse.json({ error: result.message }, { status: result.reason === 'reason_required' ? 400 : 409 })
  } catch (error) {
    console.error('[signing/decline]', error)
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 })
  }
}
