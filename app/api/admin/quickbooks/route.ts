import { NextResponse } from 'next/server'

import { demoRefusalText, isDemoOrg } from '@/lib/demo-org'
import { COMPANY_LOOKUP_UNAVAILABLE, requestHost } from '@/lib/company-host'
import { OAUTH_STATE_TTL_MS, issueOAuthState } from '@/lib/google-oauth-state'
import { loadOrgFeatures } from '@/lib/org-features'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { buildAuthorizeUrl } from '@/lib/quickbooks/api'
import { quickBooksConfig } from '@/lib/quickbooks/config'
import { QB_CONNECT_COOKIE, QB_CONNECT_COOKIE_PATH } from '@/lib/quickbooks/connect-flow'
import { disconnectQuickBooks, loadConnection, publicView, quickBooksServerReady } from '@/lib/quickbooks/connection'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The owner-only door + cross-site-write refusal is the one in lib/online-payments/access.ts (it is not Stripe-specific).

/** GET — Settings → QuickBooks: the connection's status for this company. Owners. Never returns a token. */
export async function GET() {
  const a = await requireOnlinePaymentsCaller('owner')
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const [row, features] = await Promise.all([loadConnection(a.admin, orgId), loadOrgFeatures(a.admin, orgId)])
  return NextResponse.json({ ...publicView(row, quickBooksServerReady()), featureOn: features.quickbooks })
}

/** POST { action: 'connect' } → { url } (Intuit's consent page; also sets the connect cookie); { action: 'disconnect' }. Owners. */
export async function POST(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner', request)
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const body = (await request.json().catch(() => ({}))) as { action?: string }

  if (body.action === 'connect') {
    if (await isDemoOrg(a.admin, orgId, { failClosed: true })) return NextResponse.json({ error: demoRefusalText('quickbooks') }, { status: 409 })
    const features = await loadOrgFeatures(a.admin, orgId)
    if (!features.quickbooks) return NextResponse.json({ error: 'Turn on QuickBooks in the feature switches first' }, { status: 409 })
    const cfg = quickBooksConfig()
    if (!cfg || !quickBooksServerReady()) return NextResponse.json({ error: 'QuickBooks is not set up on this server yet. Ask whoever runs your CRM.' }, { status: 503 })
    const host = requestHost(request)
    const ticket = await issueOAuthState(a.admin, { userId: a.profile.id, orgId, returnHost: host, purpose: 'quickbooks' })
    if (!ticket) return NextResponse.json({ error: 'Connecting is unavailable right now. Please try again.', code: COMPANY_LOOKUP_UNAVAILABLE }, { status: 503 })
    const res = NextResponse.json({ url: buildAuthorizeUrl(cfg, ticket.state) })
    // Binds this connect to THIS browser: the finish step refuses without it. Host-only (no Domain), httpOnly.
    res.cookies.set(QB_CONNECT_COOKIE, ticket.nonce, {
      path: QB_CONNECT_COOKIE_PATH,
      httpOnly: true,
      secure: request.url.startsWith('https'),
      sameSite: 'lax',
      maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    })
    return res
  }

  if (body.action === 'disconnect') {
    const done = await disconnectQuickBooks(a.admin, orgId, a.profile.id)
    if (!done.ok) return NextResponse.json({ error: 'Could not disconnect. Please try again.' }, { status: 500 })
    const [row, features] = await Promise.all([loadConnection(a.admin, orgId), loadOrgFeatures(a.admin, orgId)])
    return NextResponse.json({ ...publicView(row, quickBooksServerReady()), featureOn: features.quickbooks, revoked: done.revoked })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
