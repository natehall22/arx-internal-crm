import { NextResponse } from 'next/server'

import { orgAppUrl } from '@/lib/company-links'
import { getDocumentBrand } from '@/lib/org-brand'
import { createServiceClient } from '@/lib/supabase/service'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { createInvoiceCheckout, createSaveCardCheckout } from '@/lib/online-payments/checkout'
import { resolvePublicLink } from '@/lib/online-payments/public'
import { takeLinkAttempt } from '@/lib/online-payments/links'
// The shared in-memory limiter (first written for the website estimate; generic despite its name).
import { clientIpFromRequest, consumePublicEstimateRateLimit } from '@/lib/public-estimate-rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Customer taps Pay / Save card on `/pay/<token>` (no login; the link is the key, and it only works on its company's
 * own address). Returns Stripe's hosted Checkout URL. Body: { amountCents?, saveCard? } — the amount is re-checked
 * against the live balance and the company's partial-payment setting on the server.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    // Per address (one server's memory: stops a burst) and per link (in the database: every server). Each tap opens a
    // Stripe page, so a script can't make thousands of them.
    const ip = consumePublicEstimateRateLimit({ key: `pay:${clientIpFromRequest(request)}`, limit: 30, windowMs: 10 * 60_000 })
    if (!ip.ok) return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': String(ip.retryAfterSec) } })
    const admin = createServiceClient()
    const link = await resolvePublicLink(admin, params.token)
    if (!link) return NextResponse.json({ error: 'This link is not active' }, { status: 404 })
    if (!(await takeLinkAttempt(admin, link.id))) return NextResponse.json({ error: 'Too many tries on this link. Please wait 15 minutes or contact us.' }, { status: 429, headers: { 'Retry-After': '900' } })
    const body = (await request.json().catch(() => ({}))) as { amountCents?: unknown; saveCard?: unknown }
    const op = await loadOnlinePayments(admin, link.org_id)
    const brand = await getDocumentBrand(admin, link.org_id)
    const page = `${await orgAppUrl(link.org_id)}/pay/${params.token}`
    const urls = { successUrl: `${page}?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: page }
    const amount = body.amountCents == null || body.amountCents === '' ? null : Number(body.amountCents)
    const result =
      link.kind === 'save_card'
        ? await createSaveCardCheckout(admin, op, link, { companyName: brand.name }, urls)
        : await createInvoiceCheckout(admin, op, link, { amountCents: amount, saveCard: body.saveCard === true, companyName: brand.name }, urls)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ url: result.url })
  } catch (e) {
    console.error('POST /api/pay/[token] failed', e)
    return NextResponse.json({ error: 'Online payment is not available right now. Please try again or contact us.' }, { status: 500 })
  }
}
