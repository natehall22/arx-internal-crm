import { NextResponse } from 'next/server'

import { chooseSelection } from '@/lib/project-tools/selections-db'
import { resolveSelectionLink } from '@/lib/project-tools/selections-public'
import { clientIpFromRequest, consumePublicEstimateRateLimit } from '@/lib/public-estimate-rate-limit'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Customer picks an option on /s/<token> (no login; the link is the key and only works on its company's address).
 * Body: { optionId, name }. Within the allowance → done. Over → a change order is made through the existing system and the
 * reply carries its signing link, so the customer signs on the next screen.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const rl = consumePublicEstimateRateLimit({ key: `selection:${clientIpFromRequest(request)}`, limit: 30, windowMs: 10 * 60_000 })
    if (!rl.ok) return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
    const admin = createServiceClient()
    const sel = await resolveSelectionLink(admin, params.token)
    if (sel === 'feature_off') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!sel) return NextResponse.json({ error: 'This link is not active' }, { status: 404 })
    const body = (await request.json().catch(() => ({}))) as { optionId?: unknown; name?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
    if (!name) return NextResponse.json({ error: 'Please type your name' }, { status: 400 })
    const r = await chooseSelection(admin, { orgId: sel.org_id, selectionId: sel.id, optionId: String(body.optionId ?? ''), byName: name, source: 'customer' })
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, state: r.state, signingUrl: r.signingUrl })
  } catch (e) {
    console.error('POST /api/public/selections/[token] failed', e)
    return NextResponse.json({ error: 'Something went wrong. Please try again or call us.' }, { status: 500 })
  }
}
