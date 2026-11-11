import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { SIGNING_TABLES, signingTokenOf } from '@/lib/signing-tokens'
import { isSignedDocKind } from '@/lib/files/files-object'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' }

/**
 * GET /api/signing-link/<contract|change-order>/<id> — the path of a still-waiting document's signing link, for the office's
 * "Copy link" (the browser adds the company's own address). New tokens are not readable from the row, so this opens the
 * encrypted copy; the same people who can create the document, same company only. Anything else is a 404.
 */
export async function GET(_request: NextRequest, { params }: { params: { kind: string; id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE })
  }
  const { authUser, profile } = auth
  try {
    if (!isSignedDocKind(params.kind)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
    const admin = createServiceClient()
    if (await resolveSalesDocAccessBarred(admin, authUser.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE })
    }
    const { data: doc } = await admin
      .from(SIGNING_TABLES[params.kind])
      .select('status, signing_token, signing_token_enc')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()
    const token = doc?.status === 'pending_customer' ? signingTokenOf(doc) : null
    if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
    const prefix = params.kind === 'contract' ? '/contracts/sign/' : '/change-orders/sign/'
    return NextResponse.json({ path: `${prefix}${token}` }, { headers: PRIVATE })
  } catch (error) {
    console.error('[signing-link] error:', error)
    return NextResponse.json({ error: 'Could not get the link' }, { status: 500, headers: PRIVATE })
  }
}
