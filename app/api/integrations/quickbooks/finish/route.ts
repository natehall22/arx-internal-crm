import { NextRequest, NextResponse } from 'next/server'

import { CompanyLookupUnavailableError, requireAuthApi } from '@/lib/auth'
import { COMPANY_LOOKUP_UNAVAILABLE } from '@/lib/company-host'
import { discardOAuthTicket, finishOAuthConnect } from '@/lib/google-oauth-state'
import { loadOrgFeatures } from '@/lib/org-features'
import { exchangeCode, revokeToken } from '@/lib/quickbooks/api'
import { quickBooksConfig } from '@/lib/quickbooks/config'
import { QB_CONNECT_COOKIE, QB_CONNECT_COOKIE_PATH, qbReturn, unpackCallback, type QbOutcome } from '@/lib/quickbooks/connect-flow'
import { lookUpCompany, quickBooksServerReady, saveNewConnection } from '@/lib/quickbooks/connection'
import { createServiceClient } from '@/lib/supabase/service'
import { isSuperAdmin } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * Last step of the QuickBooks connect: trade Intuit's one-time code for tokens, store them (sealed), and only for the
 * signed-in OWNER who started the connect, in the browser that started it. Any other caller discards the ticket.
 */
export async function GET(request: NextRequest) {
  const done = (outcome: QbOutcome) => {
    const res = NextResponse.redirect(new URL(qbReturn(outcome), request.url))
    res.cookies.set(QB_CONNECT_COOKIE, '', { path: QB_CONNECT_COOKIE_PATH, httpOnly: true, maxAge: 0 })
    return res
  }
  const nonce = request.nextUrl.searchParams.get('nonce')
  const admin = createServiceClient()

  let auth
  try {
    auth = await requireAuthApi()
  } catch (e) {
    await discardOAuthTicket(admin, nonce) // can't prove who this is: burn the ticket and its parked code
    if (e instanceof CompanyLookupUnavailableError) {
      const res = NextResponse.json({ error: 'Temporarily unavailable', code: COMPANY_LOOKUP_UNAVAILABLE }, { status: 503 })
      res.cookies.set(QB_CONNECT_COOKIE, '', { path: QB_CONNECT_COOKIE_PATH, httpOnly: true, maxAge: 0 })
      return res
    }
    return done('invalid_state')
  }

  try {
    if (!isSuperAdmin(auth.profile)) {
      await discardOAuthTicket(admin, nonce)
      return done('owner_only')
    }
    const result = await finishOAuthConnect(admin, {
      nonce,
      cookieNonce: request.cookies.get(QB_CONNECT_COOKIE)?.value,
      userId: auth.authUser.id,
      orgId: auth.profile.org_id,
    })
    if (!result.ok) {
      console.error('QuickBooks connect finish refused:', result.reason)
      return done(result.reason === 'unavailable' ? 'failed' : 'invalid_state')
    }
    const parked = unpackCallback(result.code)
    const cfg = quickBooksConfig()
    if (!parked || !cfg || !quickBooksServerReady()) return done('failed')
    if (!(await loadOrgFeatures(admin, auth.profile.org_id)).quickbooks) return done('off')

    const exchanged = await exchangeCode(cfg, parked.code)
    if (!exchanged.ok) {
      console.error('QuickBooks code exchange failed:', exchanged.kind, exchanged.status)
      return done(exchanged.kind === 'unknown' ? 'failed' : 'intuit_refused')
    }
    const named = await lookUpCompany(cfg.environment, parked.realmId, exchanged.tokens.accessToken)
    if (!named.ok && named.kind === 'rejected') {
      await revokeToken(cfg, exchanged.tokens.refreshToken)
      return done('intuit_refused')
    }
    const saved = await saveNewConnection(admin, auth.profile.org_id, {
      realmId: parked.realmId,
      environment: cfg.environment,
      companyName: named.ok ? named.name : null,
      tokens: exchanged.tokens,
      userId: auth.profile.id,
    })
    if (!saved.ok) {
      // Nothing stored: don't leave a live grant at Intuit that we can't use.
      await revokeToken(cfg, exchanged.tokens.refreshToken)
      return done(saved.reason === 'different_company' ? 'different_company' : saved.reason === 'realm_in_use' ? 'realm_in_use' : 'failed')
    }
    return done('connected')
  } catch (e) {
    console.error('QuickBooks connect finish error:', e instanceof Error ? e.message : e)
    await discardOAuthTicket(admin, nonce)
    return done('failed')
  }
}
