import { NextResponse } from 'next/server'

import { loadOrgFeatures } from '@/lib/org-features'
import { loadApproval, makeDepositPayUrl } from '@/lib/quotes/approve'
import { resolvePublicQuoteLink } from '@/lib/quotes/links'
import { clientIpFromRequest, consumePublicEstimateRateLimit } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Customer taps "Pay deposit" on an approved quote: returns the existing pay page (`/pay/<token>`, Stripe Checkout) for the deposit invoice. */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const limited = consumePublicEstimateRateLimit({ key: `q-deposit:${clientIpFromRequest(request)}`, limit: 20, windowMs: 10 * 60_000 })
    if (!limited.ok) return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } })
    const admin = createServiceClient()
    const link = await resolvePublicQuoteLink(admin, params.token)
    if (!link || !(await loadOrgFeatures(admin, link.org_id)).quoteApproval) return NextResponse.json({ error: 'This link is not active' }, { status: 404 })
    const approval = await loadApproval(admin, link.org_id, link.proposal_id)
    if (!approval) return NextResponse.json({ error: 'This quote is not approved yet' }, { status: 409 })
    const r = await makeDepositPayUrl(admin, link.org_id, approval)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ url: r.url })
  } catch (e) {
    console.error('POST /api/q/[token]/deposit failed', e)
    return NextResponse.json({ error: 'Online payment is not available right now. Please contact us.' }, { status: 500 })
  }
}
