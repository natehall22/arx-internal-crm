import { NextResponse } from 'next/server'

import { loadOrgFeatures } from '@/lib/org-features'
import { clientIpFromRequest } from '@/lib/public-estimate-rate-limit'
import { takePortalAttempt } from '@/lib/portal/server'
import { notifyCompanyOfPortalMessage } from '@/lib/portal/messages'
import { resolvePublicQuoteLink } from '@/lib/quotes/links'
import { loadQuoteContext } from '@/lib/quotes/load'
import { createServiceClient } from '@/lib/supabase/service'
import { postCustomerMessage } from '@/lib/threads/post-message'

export const dynamic = 'force-dynamic'

/**
 * Customer taps "Ask for changes" on `/q/<token>`. Body: { message }. It goes to the office through the ONE customer-message
 * path (`postCustomerMessage`, on this quote's own deal) and the company is emailed like a portal message. Changes nothing on
 * the quote: the office edits it (a changed price makes the open page ask the customer to look again).
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const ip = clientIpFromRequest(request)
    const admin = createServiceClient()
    // The database-backed limiter (shared by every server instance), per address and below per quote link.
    if (!(await takePortalAttempt(admin, `q-changes:${ip}`, { limit: 10, windowSeconds: 600 }))) return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': '600' } })
    const link = await resolvePublicQuoteLink(admin, params.token)
    if (!link || !(await loadOrgFeatures(admin, link.org_id)).quoteApproval) return NextResponse.json({ error: 'This link is not active' }, { status: 404 })
    if (!(await takePortalAttempt(admin, `q-changes-link:${link.proposal_id}`, { limit: 5, windowSeconds: 3600 }))) return NextResponse.json({ error: 'You have sent a few messages already. Please call us instead.' }, { status: 429, headers: { 'Retry-After': '3600' } })
    const raw = (await request.json().catch(() => ({}))) as { message?: unknown }
    const message = typeof raw.message === 'string' ? raw.message.trim() : ''
    if (!message) return NextResponse.json({ error: 'Write what you would like changed first.' }, { status: 400 })
    if (message.length > 1500) return NextResponse.json({ error: 'That message is too long. Please keep it under 1,500 characters.' }, { status: 400 })
    const ctx = await loadQuoteContext(admin, link.org_id, link.proposal_id)
    if (!ctx || !ctx.customerId) return NextResponse.json({ error: 'We could not send that. Please call us.' }, { status: 409 })
    const body = `Change request on ${ctx.proposal.proposal_number ? `quote ${ctx.proposal.proposal_number}` : 'the quote'}: ${message}`
    const r = await postCustomerMessage(admin, { orgId: link.org_id, customerId: ctx.customerId, body, opportunityId: ctx.proposal.opportunity_id })
    if (!r.ok) {
      console.error('quote change request failed', r.error)
      return NextResponse.json({ error: 'We could not send that. Please try again or call us.' }, { status: 500 })
    }
    await notifyCompanyOfPortalMessage(admin, link.org_id, ctx.customerId, body).catch((e) => console.error('quote change request email failed', e))
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/q/[token]/changes failed', e)
    return NextResponse.json({ error: 'We could not send that. Please try again or call us.' }, { status: 500 })
  }
}
