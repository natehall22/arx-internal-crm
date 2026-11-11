import { NextResponse } from 'next/server'

import { orgAppUrl } from '@/lib/company-links'
import { loadOrgFeatures } from '@/lib/org-features'
import { approveQuote } from '@/lib/quotes/approve'
import { resolvePublicQuoteLink } from '@/lib/quotes/links'
import { clientIpFromRequest, consumePublicEstimateRateLimit } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Customer taps Approve on `/q/<token>` (no login; the link is the key and only works on its company's own address).
 * Body: { typedName, selectedIds, fingerprint, agreed }. The server re-prices from the database — nothing the browser sends
 * about money is trusted — and records the approval once per quote (a second tap gets the first approval back).
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const ip = clientIpFromRequest(request)
    const limited = consumePublicEstimateRateLimit({ key: `q-approve:${ip}`, limit: 20, windowMs: 10 * 60_000 })
    if (!limited.ok) return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } })
    const admin = createServiceClient()
    const link = await resolvePublicQuoteLink(admin, params.token)
    if (!link) return NextResponse.json({ error: 'This link is not active' }, { status: 404 })
    if (!(await loadOrgFeatures(admin, link.org_id)).quoteApproval) return NextResponse.json({ error: 'This link is not active' }, { status: 404 })
    const perLink = consumePublicEstimateRateLimit({ key: `q-approve-link:${link.id}`, limit: 15, windowMs: 10 * 60_000 })
    if (!perLink.ok) return NextResponse.json({ error: 'Too many tries on this link. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': String(perLink.retryAfterSec) } })
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const pageUrl = `${await orgAppUrl(link.org_id)}/q/${params.token}`
    const result = await approveQuote(admin, link, {
      typedName: body.typedName,
      selectedIds: body.selectedIds,
      fingerprint: body.fingerprint,
      agreed: body.agreed,
      ip,
      userAgent: request.headers.get('user-agent'),
      pageUrl,
    })
    if (!result.ok) return NextResponse.json({ error: result.error, changed: result.changed === true }, { status: result.status })
    return NextResponse.json({ ok: true, already: result.already, finalized: result.finalized })
  } catch (e) {
    console.error('POST /api/q/[token]/approve failed', e)
    return NextResponse.json({ error: 'We could not record your approval. Please try again or contact us.' }, { status: 500 })
  }
}
