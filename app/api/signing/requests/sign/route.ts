import { NextRequest, NextResponse } from 'next/server'

import { signingEvidence } from '@/lib/signing-input'
import { submitSignature } from '@/lib/signing/requests/sign'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST { token, signature, initials?, printName?, values, consent? } — a signer finishes. Public like the page: the link's
 * token is the credential, host-fenced (another company's address finds nothing). The server checks everything again.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { ip, userAgent } = signingEvidence(request.headers)
    const result = await submitSignature(createServiceClient(), { token: body?.token, consent: body?.consent, signature: body?.signature, initials: body?.initials, printName: body?.printName, values: body?.values, ip, userAgent })
    if (result.ok) return NextResponse.json(result)
    return NextResponse.json({ error: result.error, code: result.code, missing: result.missing }, { status: result.status })
  } catch (error) {
    console.error('[signing/requests/sign]', error)
    return NextResponse.json({ error: 'Could not save your signature. Please try again.' }, { status: 500 })
  }
}
